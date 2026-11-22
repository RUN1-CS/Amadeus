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
      }>(
        `SELECT users.id::text AS id, username, created_at AS "createdAt",
           EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS "isAdmin"
         FROM users WHERE users.id < $1::bigint
         ORDER BY users.id DESC LIMIT $2`,
        [beforeId, pageSize + 1],
      )
    : await pool.query<{
        id: string;
        username: string;
        createdAt: string;
        isAdmin: boolean;
      }>(
        `SELECT users.id::text AS id, username, created_at AS "createdAt",
           EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS "isAdmin"
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
