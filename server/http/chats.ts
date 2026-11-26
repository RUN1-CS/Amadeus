// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

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
import { readJson, sendError, sendJson } from "./shared.js";
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
      sendError(response, 400, "CHAT_TITLE_TOO_LONG", "Chat name must be at most 100 characters.");
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
      sendError(response, 404, "CHAT_NOT_FOUND", "Chat not found.");
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
      sendError(response, 400, "INVALID_CHAT_TITLE", "Chat name must contain 1 to 100 characters.");
      return true;
    }
    const chat = await renameChat(user.id, Number(chatMatch[1]), title);
    if (!chat) {
      sendError(response, 404, "CHAT_NOT_FOUND", "Chat not found.");
      return true;
    }
    sendJson(response, 200, { chat });
    return true;
  }

  if (chatMatch && request.method === "DELETE") {
    const deleted = await deleteChat(user.id, Number(chatMatch[1]));
    if (!deleted) {
      sendError(response, 404, "CHAT_NOT_FOUND", "Chat not found.");
      return true;
    }
    sendJson(response, 200, { deleted: true });
    return true;
  }

  const messagesMatch = path.match(/^\/api\/chats\/(\d+)\/messages$/);
  if (messagesMatch && request.method === "GET") {
    const messages = await getChatMessages(user.id, Number(messagesMatch[1]));
    if (!messages) {
      sendError(response, 404, "CHAT_NOT_FOUND", "Chat not found.");
      return true;
    }
    sendJson(response, 200, { messages });
    return true;
  }

  return false;
}
