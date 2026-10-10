import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { Ollama } from "ollama";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

import {
  createChat,
  createSession,
  deleteChat,
  getChatMessages,
  getUserBySession,
  listChats,
  login,
  ownsChat,
  register,
  renameChat,
  saveMessage,
  updateAccount,
  type PublicUser,
  type SavedMessage,
} from "./db.js";

const port = Number(process.env.PORT ?? 8080);
const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
});

type ClientMessage = {
  type: "authenticate" | "fetch_models" | "message";
  token?: string;
  chatId?: number;
  model?: string;
  prompt?: string;
  tsundere?: boolean;
  thinking?: boolean;
  stream?: boolean;
};

const httpServer = createServer((request, response) => {
  void handleHttpRequest(request, response);
});
const wss = new WebSocketServer({ server: httpServer });
const socketUsers = new WeakMap<WebSocket, PublicUser>();
const modelContextWindows = new Map<string, number>();
const configuredContextWindow = Math.max(
  512,
  Number(process.env.OLLAMA_NUM_CTX ?? 4096),
);
const defaultContextWindow = configuredContextWindow;
const reservedOutputTokens = 1024;

async function fetchModels() {
  const { models } = await ollama.list();
  return models;
}

let models: Awaited<ReturnType<typeof fetchModels>> = [];
let modelLoadError: string | undefined;

try {
  models = await fetchModels();
} catch (error) {
  modelLoadError = getErrorMessage(error);
  console.error("Could not load Ollama models:", error);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "An unexpected server error occurred.";
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

async function requestUser(request: IncomingMessage) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  return getUserBySession(token);
}

async function requireUser(request: IncomingMessage, response: ServerResponse) {
  const user = await requestUser(request);
  if (!user) sendJson(response, 401, { error: "Authentication required." });
  return user;
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  const path = url.pathname;

  try {
    if (request.method === "POST" && path === "/api/auth/register") {
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

    if (request.method === "POST" && path === "/api/auth/login") {
      const body = await readJson(request);
      const user = await login(
        String(body.username ?? ""),
        String(body.password ?? ""),
      );
      if (!user) {
        sendJson(response, 401, { error: "Invalid username or password." });
        return;
      }
      sendJson(response, 200, { user, token: await createSession(user.id) });
      return;
    }

    if (request.method === "GET" && path === "/api/auth/me") {
      const user = await requireUser(request, response);
      if (user) sendJson(response, 200, { user });
      return;
    }

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
      );
      if (!updatedUser) {
        sendJson(response, 401, { error: "Current password is incorrect." });
        return;
      }
      sendJson(response, 200, { user: updatedUser });
      return;
    }

    if (path === "/api/chats" && request.method === "GET") {
      const user = await requireUser(request, response);
      if (user) sendJson(response, 200, { chats: await listChats(user.id) });
      return;
    }

    if (path === "/api/chats" && request.method === "POST") {
      const user = await requireUser(request, response);
      if (!user) return;
      const body = await readJson(request);
      const chatId = await createChat(
        user.id,
        typeof body.title === "string" ? body.title : undefined,
      );
      sendJson(response, 201, { chatId });
      return;
    }

    const chatMatch = path.match(/^\/api\/chats\/(\d+)$/);
    if (chatMatch && request.method === "PATCH") {
      const user = await requireUser(request, response);
      if (!user) return;
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

    if (chatMatch && request.method === "DELETE") {
      const user = await requireUser(request, response);
      if (!user) return;
      const deleted = await deleteChat(user.id, Number(chatMatch[1]));
      if (!deleted) {
        sendJson(response, 404, { error: "Chat not found." });
        return;
      }
      sendJson(response, 200, { deleted: true });
      return;
    }

    const messagesMatch = path.match(/^\/api\/chats\/(\d+)\/messages$/);
    if (messagesMatch && request.method === "GET") {
      const user = await requireUser(request, response);
      if (!user) return;
      const messages = await getChatMessages(user.id, Number(messagesMatch[1]));
      if (!messages) {
        sendJson(response, 404, { error: "Chat not found." });
        return;
      }
      sendJson(response, 200, { messages });
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      sendJson(response, 409, {
        error: "An account with that username already exists.",
      });
      return;
    }
    sendJson(response, 500, { error: getErrorMessage(error) });
  }
}

function parseMessage(message: RawData): ClientMessage {
  return JSON.parse(message.toString()) as ClientMessage;
}

async function getModelContextWindow(model: string) {
  const cached = modelContextWindows.get(model);
  if (cached) return cached;

  const details = await ollama.show({ model });
  const modelInfo = details.model_info as unknown;
  const contextEntry =
    modelInfo instanceof Map
      ? [...modelInfo.entries()].find(([key]) =>
          key.endsWith(".context_length"),
        )
      : Object.entries((modelInfo ?? {}) as Record<string, unknown>).find(
          ([key]) => key.endsWith(".context_length"),
        );
  const modelMaxContextWindow =
    typeof contextEntry?.[1] === "number"
      ? contextEntry[1]
      : defaultContextWindow;
  const contextWindow = Math.min(
    modelMaxContextWindow,
    configuredContextWindow,
  );
  modelContextWindows.set(model, contextWindow);
  return contextWindow;
}

function estimateTokens(content: string) {
  return Math.ceil(content.length / 4);
}

function fitMessages(
  history: SavedMessage[],
  systemPrompt: string,
  currentPrompt: string,
  contextWindow: number,
) {
  const budget = Math.max(256, contextWindow - reservedOutputTokens);
  const selected: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: systemPrompt }];
  let tokenCount = estimateTokens(systemPrompt) + estimateTokens(currentPrompt);

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) continue;
    const messageTokens = estimateTokens(message.content);
    if (tokenCount + messageTokens > budget) continue;
    selected.unshift({ role: message.role, content: message.content });
    tokenCount += messageTokens;
  }

  return [...selected, { role: "user", content: currentPrompt }];
}

async function sendMessage(
  ws: WebSocket,
  user: PublicUser,
  data: ClientMessage,
) {
  if (!data.chatId || !(await ownsChat(user.id, data.chatId))) {
    throw new Error("Choose a valid chat before sending a message.");
  }

  const model = data.model ?? "";
  let prompt = data.prompt ?? "";
  if (data.tsundere) {
    prompt +=
      "\n\nYou are a tsundere. You will respond in a tsundere manner, being cold and aloof, but secretly caring and affectionate.";
  }

  const history = await getChatMessages(user.id, data.chatId);
  if (!history)
    throw new Error("Choose a valid chat before sending a message.");
  const contextWindow = await getModelContextWindow(model);
  const messages = fitMessages(
    history,
    `The current user's username is ${user.username}. Address them by name when it is natural and useful.`,
    prompt,
    contextWindow,
  );
  await saveMessage(user.id, data.chatId, "user", data.prompt ?? "", model);
  let assistantContent = "";

  if (data.stream) {
    const response = await ollama.chat({
      model,
      messages,
      think: data.thinking ?? false,
      stream: true,
      options: { num_ctx: contextWindow },
    });
    for await (const chunk of response) {
      assistantContent += chunk.message.content ?? "";
      ws.send(JSON.stringify({ type: "message", message: chunk.message }));
    }
  } else {
    const response = await ollama.chat({
      model,
      messages,
      think: data.thinking ?? false,
      stream: false,
      options: { num_ctx: contextWindow },
    });
    assistantContent = response.message.content ?? "";
    ws.send(JSON.stringify({ type: "message", message: response.message }));
  }

  await saveMessage(user.id, data.chatId, "assistant", assistantContent, model);
  ws.send(JSON.stringify({ type: "done" }));
}

async function handleSocketMessage(ws: WebSocket, rawMessage: RawData) {
  try {
    const data = parseMessage(rawMessage);

    if (data.type === "authenticate") {
      const user = await getUserBySession(data.token);
      if (!user) throw new Error("Authentication required.");
      socketUsers.set(ws, user);
      ws.send(JSON.stringify({ type: "authenticated", user }));
      return;
    }

    const user = socketUsers.get(ws);
    if (!user) throw new Error("Authenticate the WebSocket before using it.");

    if (data.type === "fetch_models") {
      ws.send(JSON.stringify({ type: "models", models }));
      if (modelLoadError)
        ws.send(JSON.stringify({ type: "error", error: modelLoadError }));
    } else if (data.type === "message") {
      await sendMessage(ws, user, data);
    }
  } catch (error) {
    console.error("Request failed:", error);
    ws.send(JSON.stringify({ type: "error", error: getErrorMessage(error) }));
    ws.send(JSON.stringify({ type: "done" }));
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    void handleSocketMessage(ws, message);
  });
});

httpServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
