// Postgres access layer for users, chat sessions, messages, and vector-memory lookups.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { Pool } from "pg";
import migrate from "./db/migrate.js";

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

// Apply additive schema changes to databases created before the current schema.
export async function initializeDatabase() {
  await migrate(pool);
}

// Strip sensitive fields down to the public user shape returned to the client.
function publicUser(
  user: Pick<UserRow, "id" | "username"> & Partial<UserRow>,
): PublicUser {
  return {
    id: user.id,
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
  const result = await pool.query<{ id: number; username: string }>(
    "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
    [normalizeUsername(username), hashPassword(password)],
  );
  return publicUser(result.rows[0]!);
}

// Look up a user by name and validate the supplied password.
export async function login(username: string, password: string) {
  const result = await pool.query<UserRow>(
    `SELECT id, username, password_hash, about_me, custom_behavior,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS is_admin
     FROM users WHERE username = $1`,
    [normalizeUsername(username)],
  );
  const user = result.rows[0];
  return user && verifyPassword(password, user.password_hash)
    ? publicUser(user)
    : null;
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
  const result = await pool.query<UserRow>(
    `SELECT id, username, password_hash,
       EXISTS (SELECT 1 FROM user_admins WHERE user_id = users.id) AS is_admin
     FROM users WHERE id = $1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user || !verifyPassword(currentPassword, user.password_hash))
    return null;

  const updated = await pool.query<UserRow>(
    `UPDATE users SET username = $1, password_hash = COALESCE($2, password_hash),
       about_me = $4, custom_behavior = $5
     WHERE id = $3 RETURNING id, username, about_me, custom_behavior`,
    [
      username.trim().toLowerCase(),
      newPassword ? hashPassword(newPassword) : null,
      userId,
      aboutMe.trim(),
      customBehavior.trim(),
    ],
  );
  return publicUser({ ...updated.rows[0]!, is_admin: user.is_admin });
}

// Create a login token that can be used to authorize future requests.
export async function createSession(userId: number) {
  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3)",
    [userId, token, new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)],
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
    [token],
  );
  return result.rows[0] ? publicUser(result.rows[0]) : null;
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
    pool.query<{ username: string; createdAt: string }>(
      `SELECT username, created_at AS "createdAt"
       FROM users ORDER BY created_at DESC LIMIT 8`,
    ),
  ]);
  return { stats: stats.rows[0]!, recentUsers: recentUsers.rows };
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
  const users = result.rows.slice(0, pageSize);
  return {
    users,
    nextCursor: hasMore ? users.at(-1)?.id ?? null : null,
  };
}

// Return the user's recent conversations sorted newest-first.
export async function listChats(userId: number): Promise<Chat[]> {
  const result = await pool.query<Chat>(
    `SELECT id, title, created_at AS "createdAt" FROM chats
		 WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows;
}

// Create a new conversation row for the authenticated user.
export async function createChat(userId: number, title = "New conversation") {
  const result = await pool.query<{ id: number }>(
    "INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING id",
    [userId, title.trim() || "New conversation"],
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
  const result = await pool.query<{
    id: number;
    title: string;
    createdAt: string;
  }>(
    `UPDATE chats SET title = $1 WHERE id = $2 AND user_id = $3
     RETURNING id, title, created_at AS "createdAt"`,
    [title.trim(), chatId, userId],
  );
  return result.rows[0] ?? null;
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
    attachments: SavedMessage["attachments"];
    createdAt: string;
  }>(
    `SELECT id, sender, content, attachments, created_at AS "createdAt" FROM messages
		 WHERE chat_id = $1 ORDER BY id`,
    [chatId],
  );
  return result.rows.map((message) => ({
    id: message.id,
    role: message.sender === "user" ? "user" : "assistant",
    content: message.content,
    model: message.sender === "user" ? undefined : message.sender,
    createdAt: message.createdAt,
    attachments: message.attachments ?? [],
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
  const sender = role === "user" ? "user" : (model ?? "assistant");
  await pool.query(
    `INSERT INTO messages (chat_id, user_id, sender, content, attachments)
     VALUES ($1, $2, $3, $4, $5)`,
    [chatId, userId, sender, content, JSON.stringify(attachments)],
  );
  if (embedding) {
    await pool.query(
      `INSERT INTO memories (user_id, content, source, metadata, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)`,
      [
        userId,
        content,
        "message",
        JSON.stringify({ chatId, role, model: model ?? null }),
        JSON.stringify(embedding),
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
  const result = await pool.query<{
    role: string;
    content: string;
    similarity: number;
  }>(
    `SELECT memories.metadata->>'role' AS role, memories.content,
       1 - (memories.embedding <=> $1::vector) AS similarity
     FROM memories
     WHERE memories.user_id = $2
       AND memories.source = 'message'
       AND memories.embedding IS NOT NULL
     ORDER BY memories.embedding <=> $1::vector
     LIMIT $3`,
    [JSON.stringify(embedding), userId, limit],
  );
  return result.rows.map((message) => ({
    role: message.role === "user" ? "user" : "assistant",
    content: message.content,
    similarity: message.similarity,
  }));
}

// Fetch all memories for a specific user, ordered newest first.
export async function getMemoriesByUserId(
  userId: number,
): Promise<MemoryRow[]> {
  const text = `
    SELECT id, user_id, content, source, metadata, created_at, updated_at
    FROM memories
    WHERE user_id = $1
    ORDER BY created_at DESC;
  `;
  const { rows } = await pool.query<MemoryRow>(text, [userId]);
  return rows;
}

// Fetch a single memory by ID and user ID.
export async function getMemoryById(
  id: number,
  userId: number,
): Promise<MemoryRow | null> {
  const text = `
    SELECT id, user_id, content, source, metadata, created_at, updated_at
    FROM memories
    WHERE id = $1 AND user_id = $2;
  `;
  const { rows } = await pool.query<MemoryRow>(text, [id, userId]);
  return rows[0] || null;
}

// Insert a new memory record.
export async function createMemory(
  params: CreateMemoryParams,
): Promise<MemoryRow> {
  const { userId, content, source, metadata = {}, embedding = null } = params;
  const text = `
    INSERT INTO memories (user_id, content, source, metadata, embedding)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id, user_id, content, source, metadata, created_at, updated_at;
  `;
  const { rows } = await pool.query<MemoryRow>(text, [
    userId,
    content,
    source,
    JSON.stringify(metadata),
    embedding ? JSON.stringify(embedding) : null,
  ]);
  return rows[0];
}

// Dynamically update a memory record.
export async function updateMemory(
  id: number,
  userId: number,
  params: UpdateMemoryParams,
): Promise<MemoryRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.content !== undefined) {
    fields.push(`content = $${idx++}`);
    values.push(params.content);
  }
  if (params.source !== undefined) {
    fields.push(`source = $${idx++}`);
    values.push(params.source);
  }
  if (params.metadata !== undefined) {
    fields.push(`metadata = $${idx++}`);
    values.push(JSON.stringify(params.metadata));
  }
  if (params.embedding !== undefined) {
    fields.push(`embedding = $${idx++}`);
    values.push(params.embedding ? JSON.stringify(params.embedding) : null);
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
    RETURNING id, user_id, content, source, metadata, created_at, updated_at;
  `;

  const { rows } = await pool.query<MemoryRow>(text, values);
  return rows[0] || null;
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

// Vector similarity search using pgvector cosine distance (<-> operator).
export async function searchMemoriesByEmbedding(
  userId: number,
  queryVector: number[],
  limit = 5,
): Promise<MemoryRow[]> {
  const text = `
    SELECT id, user_id, content, source, metadata, created_at, updated_at,
           1 - (embedding <=> $1) AS similarity
    FROM memories
    WHERE user_id = $2 AND embedding IS NOT NULL
    ORDER BY embedding <=> $1 ASC
    LIMIT $3;
  `;
  const { rows } = await pool.query<MemoryRow>(text, [
    JSON.stringify(queryVector),
    userId,
    limit,
  ]);
  return rows;
}
