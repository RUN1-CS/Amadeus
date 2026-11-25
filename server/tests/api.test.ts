import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  setUserRole: vi.fn(),
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
  isOwner: false,
};

const otherUser = {
  id: 8,
  username: "bob",
  aboutMe: "",
  customBehavior: "",
  isAdmin: false,
  isOwner: false,
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
  mocks.getCachedUserBySession.mockImplementation(async (token) => {
    if (token === "valid-token") return user;
    if (token === "other-valid-token") return otherUser;
    return undefined;
  });
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

function jsonRequest(
  method: string,
  body: unknown,
  token?: string,
): RequestInit {
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
  it("reports server readiness without authentication", async () => {
    const { response, body } = await api("/health");
    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  it("handles OPTIONS requests and sets CORS headers", async () => {
    const { response, body } = await api("/api/anything", {
      method: "OPTIONS",
    });
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

  it("User A cannot access User B's chats", async () => {
    mocks.listChats.mockImplementation(async (userId: number) =>
      userId === user.id
        ? [{ id: 12, title: "Alice chat" }]
        : [{ id: 99, title: "Bob chat" }],
    );
    mocks.getChatMessages.mockImplementation(
      async (userId: number, chatId: number) =>
        userId === otherUser.id && chatId === 99
          ? [{ id: 1, role: "user", content: "Bob secret" }]
          : null,
    );
    mocks.renameChat.mockResolvedValue(null);
    mocks.deleteChat.mockResolvedValue(false);

    const listResponse = await api("/api/chats", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(listResponse.body.chats).toEqual([{ id: 12, title: "Alice chat" }]);

    const messagesResponse = await api("/api/chats/99/messages", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(messagesResponse.response.status).toBe(404);
    expect(messagesResponse.body.localizationCode).toBe("CHAT_NOT_FOUND");
    expect(mocks.getChatMessages).toHaveBeenCalledWith(user.id, 99);

    const renameResponse = await api(
      "/api/chats/99",
      jsonRequest("PATCH", { title: "Hacked" }, "valid-token"),
    );
    expect(renameResponse.response.status).toBe(404);

    const deleteResponse = await api("/api/chats/99", {
      method: "DELETE",
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(deleteResponse.response.status).toBe(404);
  });

  it("User A cannot access User B's files", async () => {
    mocks.ownsChat.mockImplementation(
      async (userId: number, chatId: number) =>
        userId === user.id && chatId === 12,
    );

    const { response, body } = await api(
      "/api/chats/99/upload",
      jsonRequest("POST", {}, "valid-token"),
    );
    expect(response.status).toBe(404);
    expect(body.localizationCode).toBe("CHAT_NOT_FOUND");
    expect(mocks.ownsChat).toHaveBeenCalledWith(user.id, 99);
  });

  it("User A cannot access User B's memories", async () => {
    mocks.getMemoriesByUserId.mockImplementation(async (userId: number) =>
      userId === user.id
        ? [{ id: 5, content: "Alice memory" }]
        : [{ id: 50, content: "Bob memory" }],
    );
    mocks.updateMemory.mockImplementation(
      async (memoryId: number, userId: number) =>
        userId === otherUser.id && memoryId === 50
          ? { id: memoryId, content: "Bob memory" }
          : null,
    );
    mocks.deleteMemory.mockImplementation(
      async (memoryId: number, userId: number) =>
        userId === otherUser.id && memoryId === 50,
    );

    const listResponse = await api("/api/memories", {
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(listResponse.body.memories).toEqual([
      { id: 5, content: "Alice memory" },
    ]);

    const updateResponse = await api(
      "/api/memories/50",
      jsonRequest("PATCH", { content: "Hacked" }, "valid-token"),
    );
    expect(updateResponse.response.status).toBe(404);
    expect(mocks.updateMemory).toHaveBeenCalledWith(
      50,
      user.id,
      expect.any(Object),
    );

    const deleteResponse = await api("/api/memories/50", {
      method: "DELETE",
      headers: { Authorization: "Bearer valid-token" },
    });
    expect(deleteResponse.response.status).toBe(404);
  });

  it("regular users cannot access admin endpoints", async () => {
    mocks.isAdmin.mockResolvedValue(false);

    for (const path of [
      "/api/admin/overview",
      "/api/admin/users",
      "/api/admin/logs",
      "/api/admin/backups",
      "/api/admin/models",
    ]) {
      const { response, body } = await api(path, {
        headers: { Authorization: "Bearer valid-token" },
      });

      expect(response.status).toBe(403);
      expect(body.localizationCode).toBe("ADMINISTRATOR_REQUIRED");
    }
  });

  it("allows administrators to request account role changes", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    mocks.setUserRole.mockResolvedValue({
      success: true,
      affectedUserIds: [8],
    });

    const { response, body } = await api(
      "/api/admin/users/8/role",
      jsonRequest("PATCH", { role: "admin" }, "valid-token"),
    );

    expect(response.status).toBe(200);
    expect(body).toEqual({ updated: true });
    expect(mocks.setUserRole).toHaveBeenCalledWith(user.id, "8", "admin");
    expect(mocks.invalidateUserCache).toHaveBeenCalledWith(8);
  });

  it("rejects invalid roles without changing account permissions", async () => {
    mocks.isAdmin.mockResolvedValue(true);

    const { response, body } = await api(
      "/api/admin/users/8/role",
      jsonRequest("PATCH", { role: "superadmin" }, "valid-token"),
    );

    expect(response.status).toBe(400);
    expect(body.localizationCode).toBe("INVALID_USER_ROLE");
    expect(mocks.setUserRole).not.toHaveBeenCalled();
  });

  it("prevents deleting the owner account", async () => {
    mocks.deleteAccount.mockResolvedValue("owner_protected");

    const { response, body } = await api(
      "/api/auth/delete",
      jsonRequest("POST", { currentPassword: "password1" }, "valid-token"),
    );

    expect(response.status).toBe(409);
    expect(body.localizationCode).toBe("OWNER_CANNOT_BE_DELETED");
  });

  it("does not allow a regular administrator to assign the owner role", async () => {
    mocks.isAdmin.mockResolvedValue(true);
    mocks.setUserRole.mockResolvedValue({
      success: false,
      reason: "owner_required",
    });

    const { response, body } = await api(
      "/api/admin/users/8/role",
      jsonRequest("PATCH", { role: "owner" }, "valid-token"),
    );

    expect(response.status).toBe(403);
    expect(body.localizationCode).toBe("OWNER_REQUIRED");
  });

  it("expired sessions cannot access protected resources", async () => {
    for (const path of [
      "/api/auth/me",
      "/api/chats",
      "/api/memories",
      "/api/admin/overview",
    ]) {
      const { response, body } = await api(path, {
        headers: { Authorization: "Bearer expired-token" },
      });
      expect(response.status).toBe(401);
      expect(body.localizationCode).toBe("AUTHENTICATION_REQUIRED");
    }
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
      jsonRequest(
        "POST",
        { content: " Likes concise answers ", source: "manual" },
        "valid-token",
      ),
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
