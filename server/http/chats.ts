import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createChat,
  deleteChat,
  getChatMessages,
  listChats,
  ownsChat,
  renameChat,
} from "../db.js";
import type { PublicUser } from "../types.js";
import { readJson, sendJson } from "./shared.js";
import { readMultipartFiles } from "./files.js";

export async function handleChatRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  user: PublicUser,
): Promise<boolean> {
  if (path === "/api/chats" && request.method === "GET") {
    sendJson(response, 200, { chats: await listChats(user.id) });
    return true;
  }

  if (path === "/api/chats" && request.method === "POST") {
    const body = await readJson(request);
    if (
      typeof body.title === "string" &&
      Array.from(body.title.trim()).length > 100
    ) {
      sendJson(response, 400, {
        error: "Chat name must be at most 100 characters.",
      });
      return true;
    }
    const chatId = await createChat(
      user.id,
      typeof body.title === "string" ? body.title : undefined,
    );
    sendJson(response, 201, { chatId });
    return true;
  }

  const uploadMatch = path.match(/^\/api\/chats\/(\d+)\/upload$/);
  if (uploadMatch && request.method === "POST") {
    const chatId = Number(uploadMatch[1]);
    if (!(await ownsChat(user.id, chatId))) {
      sendJson(response, 404, { error: "Chat not found." });
      return true;
    }
    sendJson(response, 200, { files: await readMultipartFiles(request) });
    return true;
  }

  const chatMatch = path.match(/^\/api\/chats\/(\d+)$/);
  if (chatMatch && request.method === "PATCH") {
    const body = await readJson(request);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || Array.from(title).length > 100) {
      sendJson(response, 400, {
        error: "Chat name must contain 1 to 100 characters.",
      });
      return true;
    }
    const chat = await renameChat(user.id, Number(chatMatch[1]), title);
    if (!chat) {
      sendJson(response, 404, { error: "Chat not found." });
      return true;
    }
    sendJson(response, 200, { chat });
    return true;
  }

  if (chatMatch && request.method === "DELETE") {
    const deleted = await deleteChat(user.id, Number(chatMatch[1]));
    if (!deleted) {
      sendJson(response, 404, { error: "Chat not found." });
      return true;
    }
    sendJson(response, 200, { deleted: true });
    return true;
  }

  const messagesMatch = path.match(/^\/api\/chats\/(\d+)\/messages$/);
  if (messagesMatch && request.method === "GET") {
    const messages = await getChatMessages(user.id, Number(messagesMatch[1]));
    if (!messages) {
      sendJson(response, 404, { error: "Chat not found." });
      return true;
    }
    sendJson(response, 200, { messages });
    return true;
  }

  return false;
}
