import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  login: vi.fn(),
  createSession: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  getCachedUserBySession: vi.fn(),
  invalidateUserCache: vi.fn(),
  clearUserCache: vi.fn(),
  listChats: vi.fn(),
  createChat: vi.fn(),
  deleteChat: vi.fn(),
  renameChat: vi.fn(),
  ownsChat: vi.fn(),
  getChatMessages: vi.fn(),
  getMemoriesByUserId: vi.fn(),
  createMemory: vi.fn(),
  updateMemory: vi.fn(),
  deleteMemory: vi.fn(),
  isAdmin: vi.fn(),
  getAdminOverview: vi.fn(),
  getAdminUsers: vi.fn(),
  getServerLogs: vi.fn(),
  getAiModelAccess: vi.fn(),
  setAiModelEnabled: vi.fn(),
  reconcileUsersAfterRestore: vi.fn(),
}));

vi.mock("../db.js", () => mocks);

vi.mock("../sessions.js", () => ({
  getCachedUserBySession: mocks.getCachedUserBySession,
  invalidateUserCache: mocks.invalidateUserCache,
  clearUserCache: mocks.clearUserCache,
}));

vi.mock("../ai.js", () => ({
  getModels: vi.fn(async () => ({ models: [], error: undefined })),
  loadModels: vi.fn(),
}));

vi.mock("../comfyui.js", () => ({
  getComfyModels: vi.fn(() => ({ models: [], error: undefined })),
  loadComfyModels: vi.fn(),
  getComfyImage: vi.fn(),
}));

vi.mock("../backups.js", () => ({
  createDatabaseBackup: vi.fn(),
  createRestoreUploadPath: vi.fn(),
  restoreDatabaseBackup: vi.fn(),
  streamBackup: vi.fn(),
}));

import { createHttpServer } from "../http.js";

const user = {
  id: 7,
  username: "alice",
  aboutMe: "",
  customBehavior: "",
  isAdmin: false,
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCachedUserBySession.mockImplementation(async (token) =>
    token === "valid-token" ? user : undefined,
  );
});

async function api(
  path: string,
  options: RequestInit = {},
): Promise<{ response: Response; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body =
    response.status === 204
      ? undefined
      : await response.json().catch(() => undefined);
  return { response, body };
}

function jsonRequest(method: string, body: unknown, token?: string): RequestInit {
  return {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  };
}

describe("HTTP API", () => {
  it("handles OPTIONS requests and sets CORS headers", async () => {
    const { response, body } = await api("/api/anything", { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(body).toBeUndefined();
  });

  it("validates registration input", async () => {
    const { response, body } = await api(
      "/api/auth/register",
      jsonRequest("POST", { username: " ", password: "short" }),
    );
    expect(response.status).toBe(400);
    expect(body.localizationCode).toBe("INVALID_REGISTRATION");
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("registers a user and creates a session", async () => {
    mocks.register.mockResolvedValue(user);
    mocks.createSession.mockResolvedValue("valid-token");
    const { response, body } = await api(
      "/api/auth/register",
      jsonRequest("POST", { username: " Alice ", password: "password1" }),
    );
    expect(response.status).toBe(201);
    expect(body).toEqual({ user, token: "valid-token" });
    expect(mocks.register).toHaveBeenCalledWith(" Alice ", "password1");
  });

  it("returns 401 for invalid login credentials", async () => {
    mocks.login.mockResolvedValue(undefined);
    const { response, body } = await api(
      "/api/auth/login",
      jsonRequest("POST", { username: "alice", password: "wrongpass" }),
    );
    expect(response.status).toBe(401);
    expect(body.localizationCode).toBe("INVALID_CREDENTIALS");
  });

  it("requires authentication for /api/auth/me", async () => {
    const { response, body } = await api("/api/auth/me");
    expect(response.status).toBe(401);
    expect(body).toMatchObject({ localizationCode: "AUTHENTICATION_REQUIRED" });
  });

  it("returns the current user for a valid session", async () => {
    const { response, body } = await api("/api/auth/me", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({ user });
  });

  it("lists chats for an authenticated user", async () => {
    mocks.listChats.mockResolvedValue([{ id: 12, title: "Test chat" }]);
    const { response, body } = await api("/api/chats", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(response.status).toBe(200);
    expect(body.chats).toHaveLength(1);
    expect(mocks.listChats).toHaveBeenCalledWith(user.id);
  });

  it("creates a chat", async () => {
    mocks.createChat.mockResolvedValue(23);
    const { response, body } = await api(
      "/api/chats",
      jsonRequest("POST", { title: "New chat" }, "valid-token"),
    );
    expect(response.status).toBe(201);
    expect(body).toEqual({ chatId: 23 });
  });

  it("rejects a chat title longer than 100 characters", async () => {
    const { response, body } = await api(
      "/api/chats",
      jsonRequest("POST", { title: "x".repeat(101) }, "valid-token"),
    );
    expect(response.status).toBe(400);
    expect(body.localizationCode).toBe("CHAT_TITLE_TOO_LONG");
  });

  it("creates a memory", async () => {
    const memory = { id: 5, content: "Likes concise answers" };
    mocks.createMemory.mockResolvedValue(memory);
    const { response, body } = await api(
      "/api/memories",
      jsonRequest("POST", { content: " Likes concise answers ", source: "manual" }, "valid-token"),
    );
    expect(response.status).toBe(201);
    expect(body).toEqual({ memory });
    expect(mocks.createMemory).toHaveBeenCalledWith({
      userId: user.id,
      content: "Likes concise answers",
      source: "manual",
      metadata: {},
    });
  });

  it("returns 404 for unmatched authenticated routes", async () => {
    const { response, body } = await api("/api/does-not-exist", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(response.status).toBe(404);
    expect(body).toMatchObject({ localizationCode: "NOT_FOUND" });
  });

  it("returns malformed JSON with 400", async () => {
    const { response, body } = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    expect(response.status).toBe(400);
    expect(body.localizationCode).toBe("INVALID_JSON_BODY");
  });
});
