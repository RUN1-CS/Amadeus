import { WebSocketServer, type RawData, type WebSocket } from "ws";

import { buildChatRequest, getModels, ollama } from "./ai.js";
import { getErrorMessage } from "./errors.js";
import {
  getChatMessages,
  getUserBySession,
  ownsChat,
  saveMessage,
  type PublicUser,
} from "./db.js";
import type { ClientMessage } from "./protocol.js";

const socketUsers = new WeakMap<WebSocket, PublicUser>();

function parseMessage(message: RawData): ClientMessage {
  return JSON.parse(message.toString()) as ClientMessage;
}

async function sendMessage(
  ws: WebSocket,
  user: PublicUser,
  data: ClientMessage,
) {
  if (!data.chatId || !(await ownsChat(user.id, data.chatId))) {
    throw new Error("Choose a valid chat before sending a message.");
  }

  const history = await getChatMessages(user.id, data.chatId);
  if (!history)
    throw new Error("Choose a valid chat before sending a message.");
  const request = await buildChatRequest(user.username, data, history);
  await saveMessage(
    user.id,
    data.chatId,
    "user",
    data.prompt ?? "",
    request.model,
  );
  let assistantContent = "";

  if (data.stream) {
    const response = await ollama.chat({
      model: request.model,
      messages: request.messages,
      think: request.think,
      stream: true,
      options: { num_ctx: request.contextWindow },
    });
    for await (const chunk of response) {
      assistantContent += chunk.message.content ?? "";
      ws.send(JSON.stringify({ type: "message", message: chunk.message }));
    }
  } else {
    const response = await ollama.chat({
      model: request.model,
      messages: request.messages,
      think: request.think,
      stream: false,
      options: { num_ctx: request.contextWindow },
    });
    assistantContent = response.message.content ?? "";
    ws.send(JSON.stringify({ type: "message", message: response.message }));
  }

  await saveMessage(
    user.id,
    data.chatId,
    "assistant",
    assistantContent,
    request.model,
  );
  ws.send(JSON.stringify({ type: "done" }));
}

async function handleMessage(ws: WebSocket, rawMessage: RawData) {
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
      const result = getModels();
      ws.send(JSON.stringify({ type: "models", models: result.models }));
      if (result.error)
        ws.send(JSON.stringify({ type: "error", error: result.error }));
    } else if (data.type === "message") {
      await sendMessage(ws, user, data);
    }
  } catch (error) {
    console.error("Request failed:", error);
    ws.send(JSON.stringify({ type: "error", error: getErrorMessage(error) }));
    ws.send(JSON.stringify({ type: "done" }));
  }
}

export function attachWebSocketServer(server: import("node:http").Server) {
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.on("message", (message) => {
      void handleMessage(ws, message);
    });
  });
  return wss;
}
