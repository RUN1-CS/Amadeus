import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createMemory,
  deleteMemory,
  getMemoriesByUserId,
  updateMemory,
} from "../db.js";
import type { PublicUser } from "../types.js";
import { readJson, sendError, sendJson } from "./shared.js";

export async function handleMemoryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  user: PublicUser,
): Promise<boolean> {
  if (path === "/api/memories" && request.method === "GET") {
    sendJson(response, 200, { memories: await getMemoriesByUserId(user.id) });
    return true;
  }

  if (path === "/api/memories" && request.method === "POST") {
    const body = await readJson(request);
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!content) {
      sendError(response, 400, "MEMORY_CONTENT_REQUIRED", "Memory content cannot be empty.");
      return true;
    }
    const memory = await createMemory({
      userId: user.id,
      content,
      source:
        typeof body.source === "string" && body.source ? body.source : "manual",
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : {},
    });
    sendJson(response, 201, { memory });
    return true;
  }

  const memoryMatch = path.match(/^\/api\/memories\/(\d+)$/);
  if (memoryMatch && request.method === "PATCH") {
    const body = await readJson(request);
    const memory = await updateMemory(Number(memoryMatch[1]), user.id, {
      content:
        typeof body.content === "string" ? body.content.trim() : undefined,
      source: typeof body.source === "string" ? body.source : undefined,
      metadata:
        body.metadata && typeof body.metadata === "object"
          ? (body.metadata as Record<string, unknown>)
          : undefined,
    });
    if (!memory) {
      sendError(response, 404, "MEMORY_NOT_FOUND", "Memory not found.");
      return true;
    }
    sendJson(response, 200, { memory });
    return true;
  }

  if (memoryMatch && request.method === "DELETE") {
    const deleted = await deleteMemory(Number(memoryMatch[1]), user.id);
    if (!deleted) {
      sendError(response, 404, "MEMORY_NOT_FOUND", "Memory not found.");
      return true;
    }
    sendJson(response, 200, { deleted: true });
    return true;
  }

  return false;
}
