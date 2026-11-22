// Chat messages: history retrieval and saving (with optional embedding for retrieval).
import {
  decryptJsonValue,
  decryptUserValue,
  encryptJsonValue,
  encryptUserValue,
} from "../data-encryption.js";
import type { SavedMessage } from "../types.js";
import { pool, requireUserDataKey } from "./pool.js";
import { ownsChat } from "./chats.js";
import { insertMessageMemory } from "./memories.js";

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
      ? decryptJsonValue<SavedMessage["attachments"]>(message.attachments, key)
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
    await insertMessageMemory(userId, key, {
      content,
      chatId,
      role,
      model,
      embedding,
    });
  }
  return true;
}
