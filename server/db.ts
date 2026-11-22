// Postgres access layer for users, chat sessions, messages, and vector-memory lookups.
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { Pool } from "pg";
import migrate from "./db/migrate.js";
import { getErrorType, logger, setDatabaseLogWriter } from "./logger.js";
import { logCleanupIntervalMs, logRetentionMs } from "./config.js";
import {
  createUserDataKey,
  decryptJsonValue,
  decryptUserValue,
  encryptJsonValue,
  encryptUserValue,
  encryptLegacyUserData,
  getUserDataKey,
  removeUsersWithoutDataKeys,
  usernameLookup,
  validateDataEncryptionKey,
} from "./data-encryption.js";
import { purgeLegacyDatabaseBackups } from "./backups.js";

import type {
  MemoryRow,
  CreateMemoryParams,
  UpdateMemoryParams,
  PublicUser,
  Chat,
  SavedMessage,
  SimilarMessage,
  UserRow,
  SessionRow,
} from "./types.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function pruneServerLogs() {
  try {
    await pool.query("DELETE FROM server_logs WHERE logged_at < $1", [
      new Date(Date.now() - logRetentionMs),
    ]);
  } catch (error) {
    logger.error(
      {
        event: "database.log_retention_cleanup_failed",
        errorType: getErrorType(error),
      },
      "Could not delete expired server logs",
    );
  }
}

// Apply additive schema changes to databases created before the current schema.
export async function initializeDatabase() {
  validateDataEncryptionKey();
  await migrate(pool);
  await encryptLegacyUserData(pool);
  await purgeLegacyDatabaseBackups();
  setDatabaseLogWriter(async ({ loggedAt, level, event, metadata }) => {
    await pool.query(
      `INSERT INTO server_logs (logged_at, level, event, metadata)
       VALUES ($1, $2, $3, $4)`,
      [loggedAt, level, event, JSON.stringify(metadata)],
    );
  });
  await pruneServerLogs();
  const cleanup = setInterval(
    () => void pruneServerLogs(),
    logCleanupIntervalMs,
  );
  cleanup.unref();
}

export async function reconcileUsersAfterRestore() {
  await migrate(pool);
  await encryptLegacyUserData(pool);
  await removeUsersWithoutDataKeys(pool);
  await pool.query(
    `SELECT setval(
       pg_get_serial_sequence('users', 'id'),
       GREATEST(
         COALESCE((SELECT MAX(id) FROM users), 0),
         COALESCE((SELECT MAX(user_id) FROM user_data_keys), 0)
       ) + 1,
       false
     )`,
  );
}

// Strip sensitive fields down to the public user shape returned to the client.
function publicUser(
  user: Pick<UserRow, "id" | "username"> & Partial<UserRow>,
): PublicUser {
  return {
    id: Number(user.id),
    username: user.username,
    aboutMe: user.about_me ?? "",
    customBehavior: user.custom_behavior ?? "",
    isAdmin: user.is_admin ?? false,
  };
}

// Hash a password with a random salt before storing it in Postgres.
function hashPassword(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

// Check whether a password matches the stored hash without leaking timing data.
function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Normalize user names so sign-in and account updates behave consistently.
function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

// Create a new user account and return the public profile.
export async function register(username: string, password: string) {
  const client = await pool.connect();
  const normalizedUsername = normalizeUsername(username);
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: number }>(
      `INSERT INTO users (username, password_hash)
       VALUES ('pending', 'pending') RETURNING id`,
    );
    const userId = Number(result.rows[0]!.id);
    const key = await createUserDataKey(
      client,
      Number(userId),
      normalizedUsername,
    );
    const passwordHash = hashPassword(password);
    const encryptedUsername = encryptUserValue(normalizedUsername, key);
    const encryptedPassword = encryptUserValue(passwordHash, key);
    await client.query(
      `UPDATE users
       SET username = $2, password_hash = $3, about_me = $4,
           custom_behavior = $5
       WHERE id = $1`,
      [
        userId,
        encryptedUsername,
        encryptedPassword,
        encryptUserValue("", key),
        encryptUserValue("", key),
      ],
    );
    if (Number(userId) === 1) {
      await client.query("INSERT INTO user_admins (user_id) VALUES ($1)", [
        userId,
      ]);
    }
    await client.query("COMMIT");
    return {
      id: userId,
      username: normalizedUsername,
      aboutMe: "",
      customBehavior: "",
      isAdmin: Number(userId) === 1,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Look up a user by name and validate the supplied password.
export async function login(username: string, password: string) {
  const result = await pool.query<UserRow>(
    `SELECT users.id, users.username, users.password_hash, users.about_me,
       users.custom_behavior,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS is_admin
     FROM users
     JOIN user_data_keys ON user_data_keys.user_id = users.id
     WHERE user_data_keys.username_lookup = $1`,
    [usernameLookup(normalizeUsername(username))],
  );
  const user = result.rows[0];
  if (!user) return null;
  const key = await requireUserDataKey(user.id);
  const passwordHash = decryptUserValue(user.password_hash, key);
  if (!verifyPassword(password, passwordHash)) return null;
  return publicUser({
    ...user,
    username: decryptUserValue(user.username, key),
    about_me: decryptUserValue(user.about_me ?? "", key),
    custom_behavior: decryptUserValue(user.custom_behavior ?? "", key),
  });
}

// Update profile fields and optionally replace the password after verifying the current one.
export async function updateAccount(
  userId: number,
  currentPassword: string,
  username: string,
  newPassword?: string,
  aboutMe = "",
  customBehavior = "",
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<UserRow>(
      `SELECT id, username, password_hash, about_me,
       custom_behavior,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS is_admin
     FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );
    const user = result.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return null;
    }
    const key = await getUserDataKey(client, userId);
    if (!key) throw new Error(`Encryption key unavailable for user ${userId}.`);
    const passwordHash = decryptUserValue(user.password_hash, key);
    if (!verifyPassword(currentPassword, passwordHash)) {
      await client.query("ROLLBACK");
      return null;
    }

    const normalizedUsername = normalizeUsername(username);
    await client.query(
      "UPDATE user_data_keys SET username_lookup = $1 WHERE user_id = $2",
      [usernameLookup(normalizedUsername), userId],
    );
    const about = aboutMe.trim();
    const behavior = customBehavior.trim();
    await client.query(
      `UPDATE users
       SET username = $1, password_hash = $2, about_me = $3,
           custom_behavior = $4
       WHERE id = $5`,
      [
        encryptUserValue(normalizedUsername, key),
        encryptUserValue(
          newPassword ? hashPassword(newPassword) : passwordHash,
          key,
        ),
        encryptUserValue(about, key),
        encryptUserValue(behavior, key),
        userId,
      ],
    );
    await client.query("COMMIT");
    return publicUser({
      ...user,
      username: normalizedUsername,
      about_me: about,
      custom_behavior: behavior,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Create a login token that can be used to authorize future requests.
export async function createSession(userId: number) {
  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3)",
    [
      userId,
      createHash("sha256").update(token).digest("hex"),
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    ],
  );
  return token;
}

// Resolve the active user from a bearer token if the session is still valid.
export async function getUserBySession(token: string | undefined) {
  if (!token) return null;
  const result = await pool.query<SessionRow>(
    `SELECT users.id, users.username, users.about_me, users.custom_behavior,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS is_admin
     FROM sessions
		 JOIN users ON users.id = sessions.user_id
		 WHERE sessions.session_token = $1 AND sessions.expires_at > CURRENT_TIMESTAMP`,
    [createHash("sha256").update(token).digest("hex")],
  );
  const user = result.rows[0];
  if (!user) return null;
  const key = await requireUserDataKey(user.id);
  return publicUser({
    ...user,
    username: decryptUserValue(user.username, key),
    about_me: decryptUserValue(user.about_me ?? "", key),
    custom_behavior: decryptUserValue(user.custom_behavior ?? "", key),
  });
}

async function requireUserDataKey(userId: number) {
  const key = await getUserDataKey(pool, userId);
  if (!key) throw new Error(`Encryption key unavailable for user ${userId}.`);
  return key;
}

export async function deleteAccount(
  userId: number,
  currentPassword: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const user = result.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return false;
    }
    const key = await getUserDataKey(client, userId);
    if (
      !key ||
      !verifyPassword(currentPassword, decryptUserValue(user.password_hash, key))
    ) {
      await client.query("ROLLBACK");
      return false;
    }

    await client.query("DELETE FROM user_data_keys WHERE user_id = $1", [
      userId,
    ]);
    await client.query("DELETE FROM users WHERE id = $1", [userId]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Check admin membership on each privileged request so grants and revocations take effect immediately.
export async function isAdmin(userId: number): Promise<boolean> {
  const result = await pool.query(
    "SELECT 1 FROM user_admins WHERE user_id = $1",
    [userId],
  );
  return result.rowCount === 1;
}

export type AiModelType = "ollama" | "comfyui";

// Missing model-access records mean the model is enabled by default.
export async function getAiModelAccess(
  modelType: AiModelType,
  modelNames: string[],
) {
  if (!modelNames.length) return [];
  const result = await pool.query<{ model_name: string; enabled: boolean }>(
    `SELECT model_name, enabled FROM ai_model_access
     WHERE model_type = $1 AND model_name = ANY($2::text[])`,
    [modelType, modelNames],
  );
  const states = new Map(
    result.rows.map((row) => [row.model_name, row.enabled]),
  );
  return modelNames.map((name) => ({
    name,
    enabled: states.get(name) ?? true,
  }));
}

export async function isAiModelEnabled(
  modelType: AiModelType,
  modelName: string,
): Promise<boolean> {
  const result = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM ai_model_access
     WHERE model_type = $1 AND model_name = $2`,
    [modelType, modelName],
  );
  return result.rows[0]?.enabled ?? true;
}

export async function setAiModelEnabled(
  modelType: AiModelType,
  modelName: string,
  enabled: boolean,
) {
  await pool.query(
    `INSERT INTO ai_model_access (model_type, model_name, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (model_type, model_name)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [modelType, modelName, enabled],
  );
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
    conditions.push(
      `POSITION(LOWER($${values.length}) IN LOWER(event)) > 0`,
    );
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
    nextCursor: hasMore ? logs.at(-1)?.id ?? null : null,
  };
}

// Return the user's recent conversations sorted newest-first.
export async function listChats(userId: number): Promise<Chat[]> {
  const result = await pool.query<Omit<Chat, "title"> & { title: string }>(
    `SELECT id, title, created_at AS "createdAt" FROM chats
		 WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  const key = await requireUserDataKey(userId);
  return result.rows.map((chat) => ({
    ...chat,
    title: decryptUserValue(chat.title, key),
  }));
}

// Create a new conversation row for the authenticated user.
export async function createChat(userId: number, title = "New conversation") {
  const key = await requireUserDataKey(userId);
  const result = await pool.query<{ id: number }>(
    "INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING id",
    [userId, encryptUserValue(title.trim() || "New conversation", key)],
  );
  return result.rows[0]!.id;
}

// Remove a conversation only if it belongs to the requesting user.
export async function deleteChat(userId: number, chatId: number) {
  const result = await pool.query(
    "DELETE FROM chats WHERE id = $1 AND user_id = $2",
    [chatId, userId],
  );
  return result.rowCount === 1;
}

// Rename a chat and return the updated row if ownership checks pass.
export async function renameChat(
  userId: number,
  chatId: number,
  title: string,
) {
  const key = await requireUserDataKey(userId);
  const result = await pool.query<{
    id: number;
    title: string;
    createdAt: string;
  }>(
    `UPDATE chats SET title = $1 WHERE id = $2 AND user_id = $3
     RETURNING id, title, created_at AS "createdAt"`,
    [encryptUserValue(title.trim(), key), chatId, userId],
  );
  const chat = result.rows[0];
  return chat ? { ...chat, title: decryptUserValue(chat.title, key) } : null;
}

// Confirm that the chat belongs to the user before mutating or reading it.
export async function ownsChat(userId: number, chatId: number) {
  const result = await pool.query(
    "SELECT 1 FROM chats WHERE id = $1 AND user_id = $2",
    [chatId, userId],
  );
  return result.rowCount === 1;
}

// Fetch the stored message history for a valid user/chat pair.
export async function getChatMessages(
  userId: number,
  chatId: number,
): Promise<SavedMessage[] | null> {
  if (!(await ownsChat(userId, chatId))) return null;
  const result = await pool.query<{
    id: number;
    sender: string;
    content: string;
    attachments: string;
    createdAt: string;
  }>(
    `SELECT id, sender, content, attachments, created_at AS "createdAt" FROM messages
		 WHERE chat_id = $1 ORDER BY id`,
    [chatId],
  );
  const key = await requireUserDataKey(userId);
  return result.rows.map((message) => ({
    id: message.id,
    role: message.sender === "user" ? "user" : "assistant",
    content: decryptUserValue(message.content, key),
    model: message.sender === "user" ? undefined : message.sender,
    createdAt: message.createdAt,
    attachments: message.attachments
      ? decryptJsonValue<SavedMessage["attachments"]>(
          message.attachments,
          key,
        )
      : [],
  }));
}

// Save one user or assistant message and optionally store its embedding for retrieval.
export async function saveMessage(
  userId: number,
  chatId: number,
  role: "user" | "assistant",
  content: string,
  model?: string,
  embedding?: number[],
  attachments: SavedMessage["attachments"] = [],
) {
  if (!(await ownsChat(userId, chatId))) return false;
  const key = await requireUserDataKey(userId);
  const sender = role === "user" ? "user" : (model ?? "assistant");
  await pool.query(
    `INSERT INTO messages (chat_id, user_id, sender, content, attachments)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      chatId,
      userId,
      sender,
      encryptUserValue(content, key),
      JSON.stringify(encryptJsonValue(attachments, key)),
    ],
  );
  if (embedding) {
    await pool.query(
      `INSERT INTO memories
       (user_id, content, source, metadata, embedding, embedding_ciphertext)
       VALUES ($1, $2, $3, $4::jsonb, NULL, $5)`,
      [
        userId,
        encryptUserValue(content, key),
        encryptUserValue("message", key),
        JSON.stringify(
          encryptJsonValue({ chatId, role, model: model ?? null }, key),
        ),
        encryptUserValue(JSON.stringify(embedding), key),
      ],
    );
  }
  return true;
}

// Find memories closest to the current prompt to give the model useful context.
export async function searchSimilarMessages(
  userId: number,
  embedding: number[],
  limit: number,
): Promise<SimilarMessage[]> {
  const memories = await rankEncryptedMemories(
    userId,
    embedding,
    limit,
    true,
  );
  return memories.map(({ memory, role, similarity }) => ({
    role,
    content: memory.content,
    similarity,
  }));
}

// Fetch all memories for a specific user, ordered newest first.
export async function getMemoriesByUserId(
  userId: number,
): Promise<MemoryRow[]> {
  const text = `
    SELECT id, user_id, content, source, metadata, embedding_ciphertext,
           created_at, updated_at
    FROM memories
    WHERE user_id = $1
    ORDER BY created_at DESC;
  `;
  const { rows } = await pool.query<EncryptedMemoryRow>(text, [userId]);
  const key = await requireUserDataKey(userId);
  return rows.map((row) => decryptMemoryRow(row, key));
}

// Fetch a single memory by ID and user ID.
export async function getMemoryById(
  id: number,
  userId: number,
): Promise<MemoryRow | null> {
  const text = `
    SELECT id, user_id, content, source, metadata, embedding_ciphertext,
           created_at, updated_at
    FROM memories
    WHERE id = $1 AND user_id = $2;
  `;
  const { rows } = await pool.query<EncryptedMemoryRow>(text, [id, userId]);
  if (!rows[0]) return null;
  return decryptMemoryRow(rows[0], await requireUserDataKey(userId));
}

// Insert a new memory record.
export async function createMemory(
  params: CreateMemoryParams,
): Promise<MemoryRow> {
  const { userId, content, source, metadata = {}, embedding = null } = params;
  const key = await requireUserDataKey(userId);
  const text = `
    INSERT INTO memories
      (user_id, content, source, metadata, embedding, embedding_ciphertext)
    VALUES ($1, $2, $3, $4::jsonb, NULL, $5)
    RETURNING id, user_id, content, source, metadata, embedding_ciphertext,
              created_at, updated_at;
  `;
  const { rows } = await pool.query<EncryptedMemoryRow>(text, [
    userId,
    encryptUserValue(content, key),
    encryptUserValue(source, key),
    JSON.stringify(encryptJsonValue(metadata, key)),
    embedding ? encryptUserValue(JSON.stringify(embedding), key) : null,
  ]);
  return decryptMemoryRow(rows[0]!, key);
}

// Dynamically update a memory record.
export async function updateMemory(
  id: number,
  userId: number,
  params: UpdateMemoryParams,
): Promise<MemoryRow | null> {
  const key = await requireUserDataKey(userId);
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.content !== undefined) {
    fields.push(`content = $${idx++}`);
    values.push(encryptUserValue(params.content, key));
  }
  if (params.source !== undefined) {
    fields.push(`source = $${idx++}`);
    values.push(encryptUserValue(params.source, key));
  }
  if (params.metadata !== undefined) {
    fields.push(`metadata = $${idx++}::jsonb`);
    values.push(JSON.stringify(encryptJsonValue(params.metadata, key)));
  }
  if (params.embedding !== undefined) {
    fields.push(`embedding_ciphertext = $${idx++}`);
    values.push(
      params.embedding
        ? encryptUserValue(JSON.stringify(params.embedding), key)
        : null,
    );
    fields.push("embedding = NULL");
  }

  if (fields.length === 0) {
    return getMemoryById(id, userId);
  }

  fields.push(`updated_at = NOW()`);
  values.push(id, userId);

  const text = `
    UPDATE memories
    SET ${fields.join(", ")}
    WHERE id = $${idx++} AND user_id = $${idx++}
    RETURNING id, user_id, content, source, metadata, embedding_ciphertext,
              created_at, updated_at;
  `;

  const { rows } = await pool.query<EncryptedMemoryRow>(text, values);
  return rows[0] ? decryptMemoryRow(rows[0], key) : null;
}

// Delete a memory record by ID and user ID.
export async function deleteMemory(
  id: number,
  userId: number,
): Promise<boolean> {
  const text = `
    DELETE FROM memories
    WHERE id = $1 AND user_id = $2
    RETURNING id;
  `;
  const { rowCount } = await pool.query(text, [id, userId]);
  return (rowCount ?? 0) > 0;
}

export async function searchMemoriesByEmbedding(
  userId: number,
  queryVector: number[],
  limit = 5,
): Promise<MemoryRow[]> {
  const memories = await rankEncryptedMemories(
    userId,
    queryVector,
    limit,
    false,
  );
  return memories.map(({ memory, similarity }) => ({
    ...memory,
    similarity,
  }));
}

type EncryptedMemoryRow = Omit<MemoryRow, "content" | "source" | "metadata"> & {
  content: string;
  source: string;
  metadata: string;
  embedding_ciphertext: string | null;
};

function decryptMemoryRow(row: EncryptedMemoryRow, key: Buffer): MemoryRow {
  return {
    id: row.id,
    user_id: row.user_id,
    content: decryptUserValue(row.content, key),
    source: decryptUserValue(row.source, key),
    metadata: decryptJsonValue<Record<string, unknown>>(row.metadata, key),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function cosineSimilarity(left: number[], right: number[]) {
  const size = Math.min(left.length, right.length);
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < size; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftLength += leftValue * leftValue;
    rightLength += rightValue * rightValue;
  }
  const denominator = Math.sqrt(leftLength * rightLength);
  return denominator === 0 ? 0 : dot / denominator;
}

async function rankEncryptedMemories(
  userId: number,
  queryVector: number[],
  limit: number,
  messagesOnly: boolean,
) {
  const key = await requireUserDataKey(userId);
  const batchSize = 250;
  const ranked: {
    memory: MemoryRow;
    role: "user" | "assistant";
    similarity: number;
  }[] = [];
  let afterId = "0";

  while (true) {
    const result = await pool.query<EncryptedMemoryRow>(
      `SELECT id, user_id, content, source, metadata, embedding_ciphertext,
              created_at, updated_at
       FROM memories
       WHERE user_id = $1 AND id > $2::bigint
         AND embedding_ciphertext IS NOT NULL
       ORDER BY id ASC
       LIMIT $3`,
      [userId, afterId, batchSize],
    );
    if (result.rows.length === 0) break;
    afterId = String(result.rows.at(-1)!.id);

    for (const row of result.rows) {
      const source = decryptUserValue(row.source, key);
      if (messagesOnly && source !== "message") continue;
      const metadata = decryptJsonValue<{ role?: string }>(row.metadata, key);
      const vector = JSON.parse(
        decryptUserValue(row.embedding_ciphertext!, key),
      ) as number[];
      ranked.push({
        memory: decryptMemoryRow(row, key),
        role: metadata.role === "user" ? "user" : "assistant",
        similarity: cosineSimilarity(queryVector, vector),
      });
    }

    ranked.sort((left, right) => right.similarity - left.similarity);
    if (ranked.length > limit) ranked.length = limit;
  }

  return ranked;
}
