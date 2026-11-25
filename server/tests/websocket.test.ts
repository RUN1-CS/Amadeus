import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";

const mocks = vi.hoisted(() => ({
  getCachedUserBySession: vi.fn(),
  isAdmin: vi.fn(),
  isAiModelEnabled: vi.fn(),
  getAiModelAccess: vi.fn(),
  ownsChat: vi.fn(),
  getChatMessages: vi.fn(),
  renameChat: vi.fn(),
  saveMessage: vi.fn(),
  buildChatRequest: vi.fn(),
  chatWithTools: vi.fn(),
  generateChatTitle: vi.fn(),
  getModels: vi.fn(),
  getMessageEmbedding: vi.fn(),
  decideImageGeneration: vi.fn(),
  releaseModelForImage: vi.fn(),
  generateImage: vi.fn(),
}));

vi.mock("../sessions.js", () => ({
  getCachedUserBySession: mocks.getCachedUserBySession,
}));

vi.mock("../db.js", () => ({
  isAdmin: mocks.isAdmin,
  isAiModelEnabled: mocks.isAiModelEnabled,
  getAiModelAccess: mocks.getAiModelAccess,
  ownsChat: mocks.ownsChat,
  getChatMessages: mocks.getChatMessages,
  renameChat: mocks.renameChat,
  saveMessage: mocks.saveMessage,
}));

vi.mock("../ai.js", () => ({
  buildChatRequest: mocks.buildChatRequest,
  chatWithTools: mocks.chatWithTools,
  generateChatTitle: mocks.generateChatTitle,
  getModels: mocks.getModels,
  getMessageEmbedding: mocks.getMessageEmbedding,
  decideImageGeneration: mocks.decideImageGeneration,
  releaseModelForImage: mocks.releaseModelForImage,
}));

vi.mock("../comfyui.js", () => ({
  generateImage: mocks.generateImage,
}));

import { attachWebSocketServer } from "../websocket.js";

const user = {
  id: 7,
  username: "alice",
  aboutMe: "",
  customBehavior: "",
  isAdmin: false,
  isOwner: false,
};

let server: Server;
let wssUrl: string;

beforeAll(async () => {
  server = createServer();
  attachWebSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  wssUrl = `ws://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCachedUserBySession.mockResolvedValue(user);
  mocks.isAdmin.mockResolvedValue(false);
  mocks.isAiModelEnabled.mockResolvedValue(true);
  mocks.getAiModelAccess.mockResolvedValue([
    { name: "test-model", enabled: true },
  ]);
  mocks.ownsChat.mockResolvedValue(true);
  mocks.getChatMessages.mockResolvedValue([]);
  mocks.renameChat.mockResolvedValue(undefined);
  mocks.saveMessage.mockResolvedValue(true);
  mocks.getModels.mockReturnValue({ models: [{ name: "test-model" }] });
  mocks.getMessageEmbedding.mockResolvedValue([0.1, 0.2]);
  mocks.decideImageGeneration.mockResolvedValue({ generate: false });
  mocks.generateChatTitle.mockResolvedValue(undefined);
  mocks.buildChatRequest.mockResolvedValue({
    model: "test-model",
    messages: [],
    contextWindow: 4096,
    promptEmbedding: [0.1, 0.2],
  });
  mocks.chatWithTools.mockImplementation(
    async (_request: unknown, onChunk: (chunk: unknown) => void) => {
      onChunk({ content: "Hello " });
      onChunk({ content: "world" });
      return { message: { content: "Hello world" } };
    },
  );
});

function openSocket(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wssUrl);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket message")),
      3_000,
    );
    ws.once("message", (raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(raw.toString()));
    });
  });
}

async function sendAndCollect(ws: WebSocket, payload: unknown) {
  const response = nextMessage(ws);
  ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  return response;
}

async function collectUntilDone(ws: WebSocket, payload: unknown) {
  const messages: any[] = [];
  return new Promise<any[]>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for done")),
      3_000,
    );
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString());
      messages.push(message);
      if (message.type === "done") {
        clearTimeout(timeout);
        ws.off("message", onMessage);
        resolve(messages);
      }
    };
    ws.on("message", onMessage);
    ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
  });
}

describe("WebSocket API", () => {
  it("authenticates a connection and rejects invalid credentials", async () => {
    const ws = await openSocket();
    const authenticated = sendAndCollect(ws, {
      type: "authenticate",
      token: "valid-token",
    });
    await expect(authenticated).resolves.toMatchObject({
      type: "authenticated",
      user,
    });

    mocks.getCachedUserBySession.mockResolvedValueOnce(undefined);
    const rejected = await sendAndCollect(ws, {
      type: "authenticate",
      token: "expired-token",
    });
    expect(rejected).toMatchObject({
      type: "error",
      localizationCode: "AUTHENTICATION_REQUIRED",
    });
    expect(rejected.done).not.toBe(true);
    ws.close();
  });

  it("streams chat chunks and sends done", async () => {
    const ws = await openSocket();
    await sendAndCollect(ws, {
      type: "authenticate",
      token: "valid-token",
    });

    const messages = await collectUntilDone(ws, {
      type: "message",
      chatId: 12,
      model: "test-model",
      prompt: "Hello",
      stream: true,
    });
    expect(messages.map((message) => message.type)).toContain("message");
    expect(
      messages.filter((message) => message.type === "message").length,
    ).toBe(3);
    expect(messages.at(-1)?.type).toBe("done");
    expect(mocks.saveMessage).toHaveBeenCalledWith(
      user.id,
      12,
      "user",
      "Hello",
      "test-model",
      [0.1, 0.2],
      undefined,
    );
    ws.close();
  });

  it("rejects chat requests when the model is unavailable", async () => {
    mocks.isAiModelEnabled.mockResolvedValue(false);
    const ws = await openSocket();
    await sendAndCollect(ws, {
      type: "authenticate",
      token: "valid-token",
    });

    const messages = await collectUntilDone(ws, {
      type: "message",
      chatId: 12,
      model: "missing-model",
      prompt: "Hello",
    });
    expect(messages[0]).toMatchObject({
      type: "error",
      localizationCode: "CHAT_MODEL_UNAVAILABLE",
    });
    expect(messages.at(-1)?.type).toBe("done");
    expect(mocks.buildChatRequest).not.toHaveBeenCalled();
    ws.close();
  });

  it("returns an error when Ollama is unavailable", async () => {
    mocks.chatWithTools.mockRejectedValue(new Error("Ollama unavailable"));
    const ws = await openSocket();
    await sendAndCollect(ws, {
      type: "authenticate",
      token: "valid-token",
    });

    const messages = await collectUntilDone(ws, {
      type: "message",
      chatId: 12,
      model: "test-model",
      prompt: "Hello",
    });
    expect(messages.at(-1)?.type).toBe("done");
    expect(messages.find((message) => message.type === "error")).toMatchObject({
      localizationCode: "UNEXPECTED_SERVER_ERROR",
      error: "Ollama unavailable",
    });
    ws.close();
  });

  it("reports generation interruption after streaming partial output", async () => {
    mocks.chatWithTools.mockImplementation(
      async (_request: unknown, onChunk: (chunk: unknown) => void) => {
        onChunk({ content: "partial output" });
        throw new Error("Generation interrupted");
      },
    );
    const ws = await openSocket();
    await sendAndCollect(ws, {
      type: "authenticate",
      token: "valid-token",
    });

    const messages = await collectUntilDone(ws, {
      type: "message",
      chatId: 12,
      model: "test-model",
      prompt: "Continue",
      stream: true,
    });
    expect(messages.some((message) => message.message?.content === "partial output")).toBe(true);
    expect(messages.find((message) => message.type === "error")).toMatchObject({
      error: "Generation interrupted",
    });
    expect(messages.at(-1)?.type).toBe("done");
    ws.close();
  });

  it("supports disconnection and reconnection", async () => {
    const first = await openSocket();
    await sendAndCollect(first, {
      type: "authenticate",
      token: "valid-token",
    });
    const closed = new Promise<void>((resolve) =>
      first.once("close", () => resolve()),
    );
    first.close();
    await closed;

    const second = await openSocket();
    const result = await sendAndCollect(second, {
      type: "authenticate",
      token: "valid-token",
    });
    expect(result).toMatchObject({ type: "authenticated", user });
    second.close();
  });

  it("reports malformed JSON payloads", async () => {
    const ws = await openSocket();
    await sendAndCollect(ws, {
      type: "authenticate",
      token: "valid-token",
    });

    const messages = await collectUntilDone(ws, "{invalid");
    expect(messages.at(-1)?.type).toBe("done");
    expect(messages[0]).toMatchObject({
      type: "error",
      localizationCode: "UNEXPECTED_SERVER_ERROR",
    });
    ws.close();
  });

  it("requires authentication before protected socket actions", async () => {
    const ws = await openSocket();
    const messages = await collectUntilDone(ws, { type: "fetch_models" });
    expect(messages.at(-1)?.type).toBe("done");
    expect(messages[0]).toMatchObject({
      type: "error",
      localizationCode: "WEBSOCKET_AUTHENTICATION_REQUIRED",
    });
    ws.close();
  });

  it("rejects protected actions when a session expires during the connection", async () => {
    let sessionActive = true;
    mocks.getCachedUserBySession.mockImplementation(async (token: string) =>
      token === "valid-token" && sessionActive ? user : undefined,
    );

    const ws = await openSocket();
    await sendAndCollect(ws, {
      type: "authenticate",
      token: "valid-token",
    });
    sessionActive = false;

    const messages = await collectUntilDone(ws, { type: "fetch_models" });
    expect(messages.at(-1)?.type).toBe("done");
    expect(messages[0]).toMatchObject({
      type: "error",
      localizationCode: "WEBSOCKET_AUTHENTICATION_REQUIRED",
    });
    ws.close();
  });
});
