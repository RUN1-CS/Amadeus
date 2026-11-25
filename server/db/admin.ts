// Admin-only queries: admin membership, aggregate stats, user listing, and server logs.
import { decryptUserValue } from "../data-encryption.js";
import { pool, requireUserDataKey } from "./pool.js";

// Check admin membership on each privileged request so grants and revocations take effect immediately.
export async function isAdmin(userId: number): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM user_admins WHERE user_id = $1",
    [userId],
  );
  return result.rowCount === 1;
}

export type ManagedRole = "user" | "admin" | "owner";

export type UserRoleChange =
  | { success: true; affectedUserIds: number[] }
  | {
      success: false;
      reason: "not_admin" | "owner_required" | "owner_protected" | "not_found";
    };

export async function setUserRole(
  actorId: number,
  targetId: string,
  role: ManagedRole,
): Promise<UserRoleChange> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('amadeus_user_roles'))",
    );
    const actor = await client.query<{ is_admin: boolean; is_owner: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM user_admins WHERE user_id = $1) AS is_admin,
         EXISTS (SELECT 1 FROM user_admins WHERE user_id = $1 AND is_owner) AS is_owner`,
      [actorId],
    );
    if (!actor.rows[0]?.is_admin) {
      await client.query("ROLLBACK");
      return { success: false, reason: "not_admin" };
    }

    const target = await client.query<{ id: number; is_owner: boolean }>(
      `SELECT users.id,
         EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id AND is_owner) AS is_owner
       FROM users WHERE users.id = $1::bigint`,
      [targetId],
    );
    if (!target.rows[0]) {
      await client.query("ROLLBACK");
      return { success: false, reason: "not_found" };
    }
    if (role === "owner" && !actor.rows[0].is_owner) {
      await client.query("ROLLBACK");
      return { success: false, reason: "owner_required" };
    }
    if (target.rows[0].is_owner && role !== "owner") {
      await client.query("ROLLBACK");
      return { success: false, reason: "owner_protected" };
    }

    const affectedUserIds = [target.rows[0].id];
    if (role === "owner") {
      const currentOwner = await client.query<{ user_id: number }>(
        "SELECT user_id FROM user_admins WHERE is_owner FOR UPDATE",
      );
      if (currentOwner.rows[0]) {
        affectedUserIds.push(currentOwner.rows[0].user_id);
        await client.query(
          "UPDATE user_admins SET is_owner = FALSE WHERE user_id = $1",
          [currentOwner.rows[0].user_id],
        );
      }
      await client.query(
        `INSERT INTO user_admins (user_id, granted_by, is_owner)
         VALUES ($1::bigint, $2, TRUE)
         ON CONFLICT (user_id) DO UPDATE SET is_owner = TRUE`,
        [targetId, actorId],
      );
    } else if (role === "admin") {
      await client.query(
        `INSERT INTO user_admins (user_id, granted_by)
         VALUES ($1::bigint, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [targetId, actorId],
      );
    } else {
      await client.query("DELETE FROM user_admins WHERE user_id = $1::bigint", [
        targetId,
      ]);
    }
    await client.query("COMMIT");
    return { success: true, affectedUserIds: [...new Set(affectedUserIds)] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Return high-level account and usage metrics without exposing private chat or memory contents.
export async function getAdminOverview() {
  const [stats, recentUsers] = await Promise.all([
    pool.query<{
      users: number;
      admins: number;
      chats: number;
      messages: number;
      memories: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM users) AS users,
         (SELECT COUNT(*)::int FROM user_admins) AS admins,
         (SELECT COUNT(*)::int FROM chats) AS chats,
         (SELECT COUNT(*)::int FROM messages) AS messages,
         (SELECT COUNT(*)::int FROM memories) AS memories`,
    ),
    pool.query<{ id: number; username: string; createdAt: string }>(
      `SELECT id, username, created_at AS "createdAt"
       FROM users ORDER BY created_at DESC LIMIT 8`,
    ),
  ]);
  const recentUsersWithNames = await Promise.all(
    recentUsers.rows.map(async (row) => ({
      username: decryptUserValue(
        row.username,
        await requireUserDataKey(row.id),
      ),
      createdAt: row.createdAt,
    })),
  );
  return { stats: stats.rows[0]!, recentUsers: recentUsersWithNames };
}

// Fetch one bounded batch of account metadata using a descending ID cursor.
export async function getAdminUsers(beforeId?: string) {
  const pageSize = 30;
  const result = beforeId
    ? await pool.query<{
        id: string;
        username: string;
        createdAt: string;
        isAdmin: boolean;
        isOwner: boolean;
      }>(
        `SELECT users.id::text AS id, username, created_at AS "createdAt",
           EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS "isAdmin",
           EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id AND is_owner) AS "isOwner"
         FROM users WHERE users.id < $1::bigint
         ORDER BY users.id DESC LIMIT $2`,
        [beforeId, pageSize + 1],
      )
    : await pool.query<{
        id: string;
        username: string;
        createdAt: string;
        isAdmin: boolean;
        isOwner: boolean;
      }>(
        `SELECT users.id::text AS id, username, created_at AS "createdAt",
           EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS "isAdmin",
           EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id AND is_owner) AS "isOwner"
         FROM users ORDER BY users.id DESC LIMIT $1`,
        [pageSize + 1],
      );
  const hasMore = result.rows.length > pageSize;
  const page = result.rows.slice(0, pageSize);
  const users = await Promise.all(
    page.map(async (row) => ({
      ...row,
      username: decryptUserValue(
        row.username,
        await requireUserDataKey(Number(row.id)),
      ),
    })),
  );
  return {
    users,
    nextCursor: hasMore ? (users.at(-1)?.id ?? null) : null,
  };
}

export async function getServerLogs(filters: {
  level?: string;
  event?: string;
  beforeId?: string;
}) {
  const pageSize = 100;
  const conditions: string[] = [];
  const values: string[] = [];

  if (filters.level) {
    values.push(filters.level);
    conditions.push(`level = $${values.length}`);
  }
  if (filters.event) {
    values.push(filters.event);
    conditions.push(`POSITION(LOWER($${values.length}) IN LOWER(event)) > 0`);
  }
  if (filters.beforeId) {
    values.push(filters.beforeId);
    conditions.push(`id < $${values.length}::bigint`);
  }
  values.push(String(pageSize + 1));

  const result = await pool.query<{
    id: string;
    loggedAt: string;
    level: string;
    event: string;
    metadata: Record<string, string | number | boolean>;
  }>(
    `SELECT id::text, logged_at AS "loggedAt", level, event, metadata
     FROM server_logs
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY id DESC
     LIMIT $${values.length}`,
    values,
  );
  const hasMore = result.rows.length > pageSize;
  const logs = result.rows.slice(0, pageSize);
  return {
    logs,
    nextCursor: hasMore ? (logs.at(-1)?.id ?? null) : null,
  };
}
