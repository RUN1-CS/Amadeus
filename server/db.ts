import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export type PublicUser = {
  id: number;
  username: string;
  aboutMe: string;
  customBehavior: string;
};
export type Chat = { id: number; title: string; createdAt: string };
export type SavedMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model?: string;
  createdAt: string;
};
export type SimilarMessage = Pick<SavedMessage, "role" | "content"> & {
  similarity: number;
};

type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  about_me?: string;
  custom_behavior?: string;
};
type SessionRow = UserRow;

function publicUser(
  user: Pick<UserRow, "id" | "username"> & Partial<UserRow>,
): PublicUser {
  return {
    id: user.id,
    username: user.username,
    aboutMe: user.about_me ?? "",
    customBehavior: user.custom_behavior ?? "",
  };
}

function hashPassword(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, storedHash: string) {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export async function register(username: string, password: string) {
  const result = await pool.query<{ id: number; username: string }>(
    "INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username",
    [normalizeUsername(username), hashPassword(password)],
  );
  return publicUser(result.rows[0]!);
}

export async function login(username: string, password: string) {
  const result = await pool.query<UserRow>(
    "SELECT id, username, password_hash, about_me, custom_behavior FROM users WHERE username = $1",
    [normalizeUsername(username)],
  );
  const user = result.rows[0];
  return user && verifyPassword(password, user.password_hash)
    ? publicUser(user)
    : null;
}

export async function updateAccount(
  userId: number,
  currentPassword: string,
  username: string,
  newPassword?: string,
  aboutMe = "",
  customBehavior = "",
) {
  const result = await pool.query<UserRow>(
    "SELECT id, username, password_hash FROM users WHERE id = $1",
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
  return publicUser(updated.rows[0]!);
}

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("hex");
  await pool.query(
    "INSERT INTO sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3)",
    [userId, token, new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)],
  );
  return token;
}

export async function getUserBySession(token: string | undefined) {
  if (!token) return null;
  const result = await pool.query<SessionRow>(
    `SELECT users.id, users.username, users.about_me, users.custom_behavior FROM sessions
		 JOIN users ON users.id = sessions.user_id
		 WHERE sessions.session_token = $1 AND sessions.expires_at > CURRENT_TIMESTAMP`,
    [token],
  );
  return result.rows[0] ? publicUser(result.rows[0]) : null;
}

export async function listChats(userId: number): Promise<Chat[]> {
  const result = await pool.query<Chat>(
    `SELECT id, title, created_at AS "createdAt" FROM chats
		 WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function createChat(userId: number, title = "New conversation") {
  const result = await pool.query<{ id: number }>(
    "INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING id",
    [userId, title.trim() || "New conversation"],
  );
  return result.rows[0]!.id;
}

export async function deleteChat(userId: number, chatId: number) {
  const result = await pool.query(
    "DELETE FROM chats WHERE id = $1 AND user_id = $2",
    [chatId, userId],
  );
  return result.rowCount === 1;
}

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

export async function ownsChat(userId: number, chatId: number) {
  const result = await pool.query(
    "SELECT 1 FROM chats WHERE id = $1 AND user_id = $2",
    [chatId, userId],
  );
  return result.rowCount === 1;
}

export async function getChatMessages(
  userId: number,
  chatId: number,
): Promise<SavedMessage[] | null> {
  if (!(await ownsChat(userId, chatId))) return null;
  const result = await pool.query<{
    id: number;
    sender: string;
    content: string;
    createdAt: string;
  }>(
    `SELECT id, sender, content, created_at AS "createdAt" FROM messages
		 WHERE chat_id = $1 ORDER BY id`,
    [chatId],
  );
  return result.rows.map((message) => ({
    id: message.id,
    role: message.sender === "user" ? "user" : "assistant",
    content: message.content,
    model: message.sender === "user" ? undefined : message.sender,
    createdAt: message.createdAt,
  }));
}

export async function saveMessage(
  userId: number,
  chatId: number,
  role: "user" | "assistant",
  content: string,
  model?: string,
  embedding?: number[],
) {
  if (!(await ownsChat(userId, chatId))) return false;
  const sender = role === "user" ? "user" : (model ?? "assistant");
  await pool.query(
    `INSERT INTO messages (chat_id, user_id, sender, content)
     VALUES ($1, $2, $3, $4)`,
    [chatId, userId, sender, content],
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
