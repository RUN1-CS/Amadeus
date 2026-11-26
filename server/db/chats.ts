// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Chat (conversation) rows: listing, creation, renaming, deletion, and ownership checks.
import { decryptUserValue, encryptUserValue } from "../data-encryption.js";
import type { Chat } from "../types.js";
import { pool, requireUserDataKey } from "./pool.js";

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
