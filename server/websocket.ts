// WebSocket gateway for authenticate, model fetches, and streaming chat messages.
import { WebSocketServer, type RawData, type WebSocket } from "ws";

import {
  buildChatRequest,
  chatWithTools,
  generateChatTitle,
  getModels,
  getMessageEmbedding,
} from "./ai.js";
import { getErrorMessage } from "./errors.js";
import {
  getChatMessages,
  getUserBySession,
  ownsChat,
  renameChat,
  saveMessage,
} from "./db.js";
import type { PublicUser } from "./types.js";
import type { ClientMessage } from "./protocol.js";

const socketUsers = new WeakMap<WebSocket, PublicUser>();

// Decode a socket payload into the frontend/client message shape.
function parseMessage(message: RawData): ClientMessage {
  return JSON.parse(message.toString()) as ClientMessage;
}

// Handle a user prompt by building the model request, streaming the answer, and saving both sides.
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
  const request = await buildChatRequest(
    user.id,
    user.username,
    user.aboutMe,
    user.customBehavior,
    data,
    history,
  );
  const userEmbedding = await getMessageEmbedding(data.prompt ?? "");
  await saveMessage(
    user.id,
    data.chatId,
    "user",
    data.prompt ?? "",
    request.model,
    userEmbedding,
  );
  let assistantContent = "";

  const response = await chatWithTools(request, (chunk) => {
    ws.send(JSON.stringify({ type: "message", message: chunk }));
  });
  assistantContent = response.message.content ?? "";
  ws.send(JSON.stringify({ type: "message", message: response.message }));

  await saveMessage(
    user.id,
    data.chatId,
    "assistant",
    assistantContent,
    request.model,
    await getMessageEmbedding(assistantContent),
  );
  if (history.length === 0) {
    try {
      const title = await generateChatTitle(
        request.model,
        data.prompt ?? "",
        assistantContent,
        request.contextWindow,
      );
      if (title) {
        const chat = await renameChat(user.id, data.chatId, title);
        if (chat) ws.send(JSON.stringify({ type: "chat_title", chat }));
      }
    } catch (error) {
      console.error("Could not generate chat title:", getErrorMessage(error));
    }
  }
  ws.send(JSON.stringify({ type: "done" }));
}

// Route socket traffic for auth, model fetches, and chat sends.
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
    } else if (data.type === "memory") {
    } else if (data.type === "message") {
      await sendMessage(ws, user, data);
    }
  } catch (error) {
    console.error("Request failed:", error);
    ws.send(JSON.stringify({ type: "error", error: getErrorMessage(error) }));
    ws.send(JSON.stringify({ type: "done" }));
  }
}

// Attach the WebSocket server to the existing HTTP server and handle client connections.
export function attachWebSocketServer(server: import("node:http").Server) {
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    ws.on("message", (message) => {
      void handleMessage(ws, message);
    });
  });
  return wss;
}
