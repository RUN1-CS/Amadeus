// REST API for auth, chat CRUD, and message history.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import Busboy from "busboy";
import { PDFParse } from "pdf-parse";

import {
  createChat,
  createSession,
  deleteChat,
  getChatMessages,
  listChats,
  ownsChat,
  login,
  register,
  renameChat,
  updateAccount,
  updateMemory,
  deleteMemory,
  getMemoriesByUserId,
  createMemory,
  getAdminOverview,
  getAdminUsers,
  isAdmin,
  getAiModelAccess,
  setAiModelEnabled,
} from "./db.js";
import { getErrorMessage } from "./errors.js";
import { getComfyImage, getComfyModels, loadComfyModels } from "./comfyui.js";
import { getCachedUserBySession, invalidateUserCache } from "./sessions.js";
import { getModels, loadModels } from "./ai.js";

// An error that carries the HTTP status the client should see.
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const allowedOrigin = process.env.CORS_ORIGIN ?? "*";
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  // Let browsers cache the preflight instead of sending one before every API call.
  "Access-Control-Max-Age": "86400",
  ...(allowedOrigin === "*" ? {} : { Vary: "Origin" }),
};

// Write a JSON response with the CORS headers used by the browser client.
function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders,
  });
  response.end(JSON.stringify(body));
}

// Preflight answers must not carry a body.
function sendNoContent(response: ServerResponse) {
  response.writeHead(204, corsHeaders);
  response.end();
}

const maxJsonBytes = 1024 * 1024;

// Read the request body once and parse it as JSON for the route handlers.
// Chunks are collected as Buffers and decoded once so multi-byte characters
// split across chunks are not corrupted.
async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxJsonBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as Record<string, unknown>;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

// Very small in-memory limiter for login and register attempts.
const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: IncomingMessage, scope: string) {
  const forwarded =
    process.env.TRUST_PROXY === "true"
      ? request.headers["x-forwarded-for"]
      : undefined;
  const address =
    (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : "") ||
    request.socket.remoteAddress ||
    "unknown";
  return `${scope}:${address}`;
}

function isBlocked(key: string, max: number) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= max;
}

function recordAttempt(key: string, windowMs: number) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count += 1;
  }
  if (attempts.size > 5_000) {
    for (const [existingKey, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(existingKey);
    }
  }
}

const loginMaxFailures = 10;
const loginWindowMs = 15 * 60 * 1000;
const registerMaxAttempts = 10;
const registerWindowMs = 60 * 60 * 1000;

const maxUploadBytes = 10 * 1024 * 1024;
const maxUploadFiles = 5;
const maxExtractedTextChars = 50_000;

type UploadedFile = {
  name: string;
  kind: "image" | "pdf" | "file";
  content?: string;
  data?: string;
};

function truncateText(text: string, notice: string) {
  if (text.length <= maxExtractedTextChars) return text;
  return `${text.slice(0, maxExtractedTextChars)}\n${notice}`;
}

async function extractPdfText(data: Buffer) {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (!text) return "[No extractable text found in this PDF.]";
    return truncateText(text, "[PDF text truncated.]");
  } finally {
    await parser.destroy();
  }
}

// Binary files decoded as UTF-8 are just noise in a prompt; NUL bytes are a cheap tell.
function looksBinary(bytes: Buffer) {
  return bytes.subarray(0, 8_192).includes(0);
}

// Turn one uploaded part into the shape the client expects.
async function toUploadedFile(
  name: string,
  mimeType: string,
  bytes: Buffer,
): Promise<UploadedFile> {
  if (mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    return { name, kind: "pdf", content: await extractPdfText(bytes) };
  }
  if (mimeType.startsWith("image/")) {
    return { name, kind: "image", data: bytes.toString("base64") };
  }
  if (looksBinary(bytes)) {
    throw new HttpError(
      415,
      `${name} looks like a binary file and can't be read as text.`,
    );
  }
  return {
    name,
    kind: "file",
    content: truncateText(bytes.toString("utf8"), "[File text truncated.]"),
  };
}

// Stream uploaded files out of the multipart form without storing them on disk.
// PDF extraction for several files runs in parallel once the upload finishes.
function readMultipartFiles(request: IncomingMessage) {
  return new Promise<UploadedFile[]>((resolve, reject) => {
    let busboy: ReturnType<typeof Busboy>;
    try {
      busboy = Busboy({
        headers: request.headers,
        defParamCharset: "utf8",
        limits: { fileSize: maxUploadBytes, files: maxUploadFiles },
      });
    } catch {
      reject(new HttpError(400, "Invalid multipart upload."));
      return;
    }

    const pending: Promise<UploadedFile>[] = [];
    let failed = false;
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      request.unpipe(busboy);
      request.resume();
      reject(error);
    };

    busboy.on("file", (_field, stream, info) => {
      const { filename, mimeType } = info;
      if (!filename) {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () =>
        fail(new HttpError(413, "Uploads must be smaller than 10 MB.")),
      );
      stream.on("end", () => {
        if (failed) return;
        const task = toUploadedFile(
          filename,
          mimeType.toLowerCase(),
          Buffer.concat(chunks),
        );
        task.catch(() => {}); // avoid an unhandled rejection; Promise.all below reports it
        pending.push(task);
      });
    });
    busboy.on("filesLimit", () =>
      fail(
        new HttpError(413, `Upload at most ${maxUploadFiles} files at once.`),
      ),
    );
    busboy.on("error", fail);
    busboy.on("close", () => {
      if (failed) return;
      Promise.all(pending).then(resolve, reject);
    });

    request.pipe(busboy);
  });
}

// Require a valid bearer token before allowing protected API routes.
async function requireUser(request: IncomingMessage, response: ServerResponse) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const user = await getCachedUserBySession(token);
  if (!user) sendJson(response, 401, { error: "Authentication required." });
  return user;
}

// ComfyUI references come from the query string, so keep them from escaping its folders.
function isSafeSubfolder(subfolder: string) {
  if (!subfolder) return true;
  return (
    /^[\w .-]+(\/[\w .-]+)*$/.test(subfolder) &&
    !subfolder.split("/").includes("..")
  );
}

function getOllamaModelNames(models: unknown[]) {
  return models.flatMap((model) =>
    typeof model === "object" &&
    model !== null &&
    "name" in model &&
    typeof model.name === "string"
      ? [model.name]
      : [],
  );
}

// Route each HTTP request to the right auth, account, chat, or message handler.
// It validates the method/path, enforces auth for protected endpoints, and sends
// JSON responses for both success and error cases.
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
    // Register a new account with a username and password.
    if (request.method === "POST" && path === "/api/auth/register") {
      const key = clientKey(request, "register");
      if (isBlocked(key, registerMaxAttempts)) {
        sendJson(response, 429, {
          error: "Too many sign-up attempts. Try again later.",
        });
        return;
      }
      recordAttempt(key, registerWindowMs);
      const body = await readJson(request);
      const username = typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!username || password.length < 8) {
        sendJson(response, 400, {
          error: "Use a username and a password of at least 8 characters.",
        });
        return;
      }
      const user = await register(username, password);
      sendJson(response, 201, { user, token: await createSession(user.id) });
      return;
    }

    // Log in an existing user and issue a fresh session token.
    if (request.method === "POST" && path === "/api/auth/login") {
      const key = clientKey(request, "login");
      if (isBlocked(key, loginMaxFailures)) {
        sendJson(response, 429, {
          error: "Too many failed logins. Try again later.",
        });
        return;
      }
      const body = await readJson(request);
      const user = await login(
        String(body.username ?? ""),
        String(body.password ?? ""),
      );
      if (!user) {
        recordAttempt(key, loginWindowMs);
        sendJson(response, 401, { error: "Invalid username or password." });
        return;
      }
      attempts.delete(key);
      sendJson(response, 200, { user, token: await createSession(user.id) });
      return;
    }

    // Return the logged-in user's public profile for the app shell.
    if (request.method === "GET" && path === "/api/auth/me") {
      const user = await requireUser(request, response);
      if (user) sendJson(response, 200, { user });
      return;
    }

    // Update account fields, including optional password changes, after verifying the current password.
    if (request.method === "PATCH" && path === "/api/auth/account") {
      const user = await requireUser(request, response);
      if (!user) return;
      const body = await readJson(request);
      const username =
        typeof body.username === "string" ? body.username.trim() : "";
      const currentPassword =
        typeof body.currentPassword === "string" ? body.currentPassword : "";
      const newPassword =
        typeof body.newPassword === "string" ? body.newPassword : "";
      const aboutMe = typeof body.aboutMe === "string" ? body.aboutMe : "";
      const customBehavior =
        typeof body.customBehavior === "string" ? body.customBehavior : "";
      if (
        !username ||
        !currentPassword ||
        (newPassword && newPassword.length < 8)
      ) {
        sendJson(response, 400, {
          error:
            "Enter a username, current password, and a valid new password.",
        });
        return;
      }
      const updatedUser = await updateAccount(
        user.id,
        currentPassword,
        username,
        newPassword || undefined,
        aboutMe,
        customBehavior,
      );
      if (!updatedUser) {
        sendJson(response, 401, { error: "Current password is incorrect." });
        return;
      }
      // The system prompt uses aboutMe/customBehavior, so cached profiles must not go stale.
      invalidateUserCache(user.id);
      sendJson(response, 200, { user: updatedUser });
      return;
    }

    // From here, every route requires a valid login session.
    const user = await requireUser(request, response);
    if (!user) return;

    if (path === "/api/admin/overview" && request.method === "GET") {
      if (!(await isAdmin(user.id))) {
        sendJson(response, 403, {
          error: "Administrator access is required.",
        });
        return;
      }

      const [overview, ollamaModels] = await Promise.all([
        getAdminOverview(),
        getModels(),
      ]);
      const comfyModels = getComfyModels();
      const ollamaNames = getOllamaModelNames(ollamaModels.models);
      sendJson(response, 200, {
        ...overview,
        services: {
          ollama: {
            status: ollamaModels.error
              ? ollamaNames.length
                ? "degraded"
                : "unavailable"
              : ollamaNames.length
                ? "available"
                : "unavailable",
            models: ollamaNames,
            error: ollamaModels.error,
          },
          comfyui: {
            status: comfyModels.error
              ? comfyModels.models.length
                ? "degraded"
                : "unavailable"
              : comfyModels.models.length
                ? "available"
                : "unavailable",
            models: comfyModels.models,
            error: comfyModels.error,
          },
        },
      });
      return;
    }

    if (path === "/api/admin/users" && request.method === "GET") {
      if (!(await isAdmin(user.id))) {
        sendJson(response, 403, {
          error: "Administrator access is required.",
        });
        return;
      }

      const beforeId = url.searchParams.get("beforeId") ?? undefined;
      if (beforeId !== undefined && !/^[1-9]\d*$/.test(beforeId)) {
        sendJson(response, 400, { error: "Invalid user pagination cursor." });
        return;
      }
      sendJson(response, 200, await getAdminUsers(beforeId));
      return;
    }

    if (path === "/api/admin/models" && request.method === "GET") {
      if (!(await isAdmin(user.id))) {
        sendJson(response, 403, {
          error: "Administrator access is required.",
        });
        return;
      }

      const [ollamaModels, comfyModelNames] = await Promise.all([
        loadModels(),
        loadComfyModels(),
      ]);
      const ollamaNames = getOllamaModelNames(ollamaModels);
      sendJson(response, 200, {
        ollama: await getAiModelAccess("ollama", ollamaNames),
        comfyui: await getAiModelAccess("comfyui", comfyModelNames),
        errors: {
          ollama: getModels().error,
          comfyui: getComfyModels().error,
        },
      });
      return;
    }

    if (path === "/api/admin/models" && request.method === "PATCH") {
      if (!(await isAdmin(user.id))) {
        sendJson(response, 403, {
          error: "Administrator access is required.",
        });
        return;
      }

      const body = await readJson(request);
      const modelType = body.modelType;
      const modelName =
        typeof body.modelName === "string" ? body.modelName.trim() : "";
      if (
        (modelType !== "ollama" && modelType !== "comfyui") ||
        !modelName ||
        typeof body.enabled !== "boolean"
      ) {
        sendJson(response, 400, {
          error: "Provide a valid model type, model name, and enabled state.",
        });
        return;
      }

      const availableModels =
        modelType === "ollama"
          ? getOllamaModelNames(getModels().models)
          : getComfyModels().models;
      if (!availableModels.includes(modelName)) {
        sendJson(response, 404, { error: "AI model not found." });
        return;
      }

      await setAiModelEnabled(modelType, modelName, body.enabled);
      sendJson(response, 200, { modelType, modelName, enabled: body.enabled });
      return;
    }

    if (path === "/api/comfy/models" && request.method === "GET") {
      if (getComfyModels().models.length === 0) await loadComfyModels();
      const result = getComfyModels();
      const models = await getAiModelAccess("comfyui", result.models);
      sendJson(response, 200, {
        ...result,
        models: (await isAdmin(user.id))
          ? result.models
          : models.filter((model) => model.enabled).map((model) => model.name),
      });
      return;
    }

    // Proxy a generated image from ComfyUI, streaming it instead of buffering it.
    if (path === "/api/comfy/image" && request.method === "GET") {
      const filename = url.searchParams.get("filename") ?? "";
      const subfolder = url.searchParams.get("subfolder") ?? "";
      const type = url.searchParams.get("type") ?? "output";
      if (
        !filename ||
        filename === ".." ||
        /[/\\]/.test(filename) ||
        !isSafeSubfolder(subfolder) ||
        !["output", "input", "temp"].includes(type)
      ) {
        sendJson(response, 400, { error: "Invalid ComfyUI image reference." });
        return;
      }
      const upstream = await getComfyImage({ filename, subfolder, type });
      if (!upstream.ok || !upstream.body) {
        sendJson(response, upstream.status === 404 ? 404 : 502, {
          error: "Image not available.",
        });
        return;
      }
      response.writeHead(200, {
        "Content-Type": upstream.headers.get("content-type") ?? "image/png",
        // Output filenames are unique, so they can be cached for good; input/temp can be reused.
        "Cache-Control":
          type === "output"
            ? "private, max-age=31536000, immutable"
            : "private, max-age=3600",
        "Access-Control-Allow-Origin": allowedOrigin,
      });
      await pipeline(
        Readable.fromWeb(upstream.body as unknown as WebReadableStream),
        response,
      );
      return;
    }

    // Fetch all chats owned by the signed-in user.
    if (path === "/api/chats" && request.method === "GET") {
      sendJson(response, 200, { chats: await listChats(user.id) });
      return;
    }

    // Create a new conversation for the authenticated user.
    if (path === "/api/chats" && request.method === "POST") {
      const body = await readJson(request);
      const chatId = await createChat(
        user.id,
        typeof body.title === "string" ? body.title : undefined,
      );
      sendJson(response, 201, { chatId });
      return;
    }

    // Read uploaded files and return their contents for the current model request.
    const uploadMatch = path.match(/^\/api\/chats\/(\d+)\/upload$/);
    if (uploadMatch && request.method === "POST") {
      const chatId = Number(uploadMatch[1]);
      if (!(await ownsChat(user.id, chatId))) {
        sendJson(response, 404, { error: "Chat not found." });
        return;
      }
      sendJson(response, 200, { files: await readMultipartFiles(request) });
      return;
    }

    // Rename an existing chat, if it belongs to this user.
    const chatMatch = path.match(/^\/api\/chats\/(\d+)$/);
    if (chatMatch && request.method === "PATCH") {
      const body = await readJson(request);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        sendJson(response, 400, { error: "Chat name cannot be empty." });
        return;
      }
      const chat = await renameChat(user.id, Number(chatMatch[1]), title);
      if (!chat) {
        sendJson(response, 404, { error: "Chat not found." });
        return;
      }
      sendJson(response, 200, { chat });
      return;
    }

    // Delete a chat only when ownership matches the signed-in user.
    if (chatMatch && request.method === "DELETE") {
      const deleted = await deleteChat(user.id, Number(chatMatch[1]));
      if (!deleted) {
        sendJson(response, 404, { error: "Chat not found." });
        return;
      }
      sendJson(response, 200, { deleted: true });
      return;
    }

    // List all memories for the signed-in user.
    if (path === "/api/memories" && request.method === "GET") {
      sendJson(response, 200, { memories: await getMemoriesByUserId(user.id) });
      return;
    }

    // Create a memory.
    if (path === "/api/memories" && request.method === "POST") {
      const body = await readJson(request);
      const content =
        typeof body.content === "string" ? body.content.trim() : "";
      if (!content) {
        sendJson(response, 400, { error: "Memory content cannot be empty." });
        return;
      }
      const memory = await createMemory({
        userId: user.id,
        content,
        source:
          typeof body.source === "string" && body.source
            ? body.source
            : "manual",
        metadata:
          body.metadata && typeof body.metadata === "object"
            ? (body.metadata as Record<string, unknown>)
            : {},
      });
      sendJson(response, 201, { memory });
      return;
    }

    const memoryMatch = path.match(/^\/api\/memories\/(\d+)$/);

    // Update a memory the user owns.
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
        sendJson(response, 404, { error: "Memory not found." });
        return;
      }
      sendJson(response, 200, { memory });
      return;
    }

    // Delete a memory the user owns.
    if (memoryMatch && request.method === "DELETE") {
      const deleted = await deleteMemory(Number(memoryMatch[1]), user.id);
      if (!deleted) {
        sendJson(response, 404, { error: "Memory not found." });
        return;
      }
      sendJson(response, 200, { deleted: true });
      return;
    }

    // Load the saved messages for one conversation.
    const messagesMatch = path.match(/^\/api\/chats\/(\d+)\/messages$/);
    if (messagesMatch && request.method === "GET") {
      const messages = await getChatMessages(user.id, Number(messagesMatch[1]));
      if (!messages) {
        sendJson(response, 404, { error: "Chat not found." });
        return;
      }
      sendJson(response, 200, { messages });
      return;
    }

    // Fall through to a 404 when the route does not match any known API endpoint.
    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    // A streamed response that already started can't be turned into a JSON error.
    if (response.headersSent) {
      response.destroy();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    if ((error as { code?: string }).code === "23505") {
      sendJson(response, 409, { error: "That username is already taken." });
      return;
    }
    console.error("Request failed:", error);
    sendJson(response, 500, {
      error:
        process.env.NODE_ENV === "production"
          ? "Something went wrong."
          : getErrorMessage(error),
    });
  }
}

// Start the HTTP server with the route dispatcher attached.
export function createHttpServer() {
  return createServer((request, response) => {
    void handleRequest(request, response);
  });
}
