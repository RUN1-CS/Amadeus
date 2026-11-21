// WebSocket gateway for authenticate, model fetches, and streaming chat messages.
import { WebSocketServer, type RawData, type WebSocket } from "ws";

import {
  buildChatRequest,
  chatWithTools,
  generateChatTitle,
  getModels,
  getMessageEmbedding,
  decideImageGeneration,
  releaseModelForImage,
} from "./ai.js";
import { getErrorMessage } from "./errors.js";
import { getChatMessages, ownsChat, renameChat, saveMessage } from "./db.js";
import { getCachedUserBySession } from "./sessions.js";
import type { PublicUser } from "./types.js";
import type { ClientMessage } from "./protocol.js";
import { generateImage } from "./comfyui.js";

// Images arrive base64-encoded over this socket, so allow room for them but not the 100 MiB default.
const maxPayloadBytes = 25 * 1024 * 1024;
const heartbeatMs = 30_000;

// Session token per socket; the user is re-resolved (cheaply, via cache) on each message
// so profile changes and expired sessions take effect without reconnecting.
const socketTokens = new WeakMap<WebSocket, string>();
// Messages on one socket run one at a time so replies can't interleave.
const socketQueues = new WeakMap<WebSocket, Promise<void>>();
const socketAlive = new WeakSet<WebSocket>();

// Send a JSON payload only while the socket is still open.
function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

// Decode a socket payload into the frontend/client message shape.
function parseMessage(message: RawData): ClientMessage {
  return JSON.parse(message.toString()) as ClientMessage;
}

// Confirm the chat belongs to the user before doing any work for it.
async function requireOwnedChat(
  user: PublicUser,
  chatId: number | undefined,
  action: string,
) {
  if (!chatId || !(await ownsChat(user.id, chatId))) {
    throw new Error(`Choose a valid chat before ${action}.`);
  }
  return chatId;
}

// Generate an image, save both sides of the exchange, and send the result.
// The caller has already verified chat ownership.
async function generateAndSendImage(
  ws: WebSocket,
  user: PublicUser,
  chatId: number,
  data: ClientMessage,
) {
  const positivePrompt = data.positivePrompt ?? data.prompt ?? "";
  await releaseModelForImage(data.model ?? "");
  const image = await generateImage(
    data.generativeModel ?? "",
    positivePrompt,
    data.negativePrompt ?? "",
  );
  const attachment = {
    name: image.filename,
    kind: "image" as const,
    url: `/api/comfy/image?${new URLSearchParams(image).toString()}`,
  };
  await saveMessage(
    user.id,
    chatId,
    "user",
    data.prompt ?? positivePrompt,
    data.generativeModel,
    undefined,
    data.attachments,
  );
  await saveMessage(
    user.id,
    chatId,
    "assistant",
    "Generated image",
    data.generativeModel,
    undefined,
    [attachment],
  );
  send(ws, {
    type: "message",
    message: { content: "Generated image", attachments: [attachment] },
    full: true,
  });
  send(ws, { type: "done" });
}

// Direct "generate_image" requests from the client.
async function handleGenerateImage(
  ws: WebSocket,
  user: PublicUser,
  data: ClientMessage,
) {
  const chatId = await requireOwnedChat(
    user,
    data.chatId,
    "generating an image",
  );
  await generateAndSendImage(ws, user, chatId, data);
}

// Name a new chat from its first exchange. Failures are logged and ignored.
async function titleFirstExchange(
  user: PublicUser,
  chatId: number,
  model: string,
  prompt: string,
  reply: string,
  contextWindow: number,
) {
  try {
    const title = await generateChatTitle(model, prompt, reply, contextWindow);
    return title ? await renameChat(user.id, chatId, title) : undefined;
  } catch (error) {
    console.error("Could not generate chat title:", getErrorMessage(error));
    return undefined;
  }
}

// Handle a user prompt by building the model request, streaming the answer, and saving both sides.
async function sendMessage(
  ws: WebSocket,
  user: PublicUser,
  data: ClientMessage,
) {
  const chatId = data.chatId;
  const prompt = data.prompt ?? "";

  // getChatMessages returns nothing for chats the user doesn't own, so it doubles as the ownership check.
  const history = chatId ? await getChatMessages(user.id, chatId) : undefined;
  if (!chatId || !history) {
    throw new Error("Choose a valid chat before sending a message.");
  }

  const request = await buildChatRequest(
    user.id,
    user.username,
    user.aboutMe,
    user.customBehavior,
    data,
    history,
  );

  const imageDecision = await decideImageGeneration(
    request.model,
    prompt,
    request.contextWindow,
  );
  if (imageDecision.generate) {
    await generateAndSendImage(ws, user, chatId, {
      ...data,
      model: request.model,
      positivePrompt: imageDecision.positive,
      negativePrompt: imageDecision.negative,
    });
    return;
  }

  // Save the user message while the model is generating; the embedding was
  // already computed for memory search.
  const userSaved = saveMessage(
    user.id,
    chatId,
    "user",
    prompt,
    request.model,
    request.promptEmbedding,
    data.attachments,
  );
  userSaved.catch(() => {}); // surfaced by the await below

  const response = await chatWithTools(request, (chunk) => {
    send(ws, { type: "message", message: chunk });
  });
  await userSaved; // keep DB order: user message before the assistant reply
  const assistantContent = response.message.content ?? "";
  send(ws, { type: "message", message: response.message, full: true });

  // Persisting the reply and naming the chat don't depend on each other.
  const saveReply = getMessageEmbedding(assistantContent).then((embedding) =>
    saveMessage(
      user.id,
      chatId,
      "assistant",
      assistantContent,
      request.model,
      embedding,
    ),
  );
  const nameChat =
    history.length === 0
      ? titleFirstExchange(
          user,
          chatId,
          request.model,
          prompt,
          assistantContent,
          request.contextWindow,
        )
      : Promise.resolve(undefined);
  const [, chat] = await Promise.all([saveReply, nameChat]);

  if (chat) send(ws, { type: "chat_title", chat });
  send(ws, { type: "done" });
}

// Route socket traffic for auth, model fetches, and chat sends.
async function handleMessage(ws: WebSocket, rawMessage: RawData) {
  try {
    const data = parseMessage(rawMessage);
    if (data.type === "authenticate") {
      const user = await getCachedUserBySession(data.token);
      if (!user || !data.token) throw new Error("Authentication required.");
      socketTokens.set(ws, data.token);
      send(ws, { type: "authenticated", user });
      return;
    }

    const token = socketTokens.get(ws);
    const user = token ? await getCachedUserBySession(token) : undefined;
    if (!user) throw new Error("Authenticate the WebSocket before using it.");

    if (data.type === "fetch_models") {
      const result = getModels();
      send(ws, { type: "models", models: result.models });
      if (result.error) send(ws, { type: "error", error: result.error });
    } else if (data.type === "message") {
      await sendMessage(ws, user, data);
    } else if (data.type === "generate_image") {
      await handleGenerateImage(ws, user, data);
    }
  } catch (error) {
    console.error("Request failed:", error);
    send(ws, { type: "error", error: getErrorMessage(error) });
    send(ws, { type: "done" });
  }
}

// Attach the WebSocket server to the existing HTTP server and handle client connections.
export function attachWebSocketServer(server: import("node:http").Server) {
  const wss = new WebSocketServer({ server, maxPayload: maxPayloadBytes });

  wss.on("connection", (ws) => {
    socketAlive.add(ws);
    ws.on("pong", () => socketAlive.add(ws));
    ws.on("error", (error) => {
      console.error("WebSocket error:", getErrorMessage(error));
    });
    ws.on("message", (message) => {
      const previous = socketQueues.get(ws) ?? Promise.resolve();
      socketQueues.set(
        ws,
        previous.then(() => handleMessage(ws, message)).catch(() => {}),
      );
    });
  });

  // Drop connections that stopped answering pings and keep idle ones alive through proxies.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!socketAlive.has(ws)) {
        ws.terminate();
        continue;
      }
      socketAlive.delete(ws);
      ws.ping();
    }
  }, heartbeatMs);
  wss.on("close", () => clearInterval(heartbeat));

  return wss;
}
