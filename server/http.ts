import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { getErrorMessage } from "./errors.js";
import { getErrorType, logger } from "./logger.js";
import { handleAdminRequest } from "./http/admin.js";
import { handleAuthRequest } from "./http/auth.js";
import { handleChatRequest } from "./http/chats.js";
import { handleComfyRequest } from "./http/comfy.js";
import { handleMemoryRequest } from "./http/memories.js";
import { requireUser, sendJson, sendNoContent } from "./http/shared.js";
import { HttpError } from "./classes/httpError.js";

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method === "OPTIONS") {
    sendNoContent(response);
    return;
  }

  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  const path = url.pathname;

  try {
    if (await handleAuthRequest(request, response, path)) return;

    const user = await requireUser(request, response);
    if (!user) return;

    if (await handleAdminRequest(request, response, url, user)) return;
    if (await handleComfyRequest(request, response, url, user)) return;
    if (await handleChatRequest(request, response, path, user)) return;
    if (await handleMemoryRequest(request, response, path, user)) return;

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      sendJson(response, 409, { error: "That username is already taken." });
      return;
    }
    logger.error(
      { event: "http.request_failed", errorType: getErrorType(error) },
      "HTTP request failed",
    );
    sendJson(response, 500, {
      error:
        process.env.NODE_ENV === "production"
          ? "Something went wrong."
          : getErrorMessage(error),
    });
  }
}

export function createHttpServer() {
  return createServer((request, response) => {
    const startedAt = Date.now();
    response.once("finish", () => {
      logger.info({
        event: "http.request",
        method: request.method,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    void handleRequest(request, response);
  });
}
