import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  isOpen: vi.fn(),
  send: vi.fn(),
  socketOptions: undefined as
    | {
        onMessage: (message: string) => void;
        onUnexpectedClose: () => void;
      }
    | undefined,
}));

vi.mock("@/services/api", () => ({
  createApiClient: () => ({ request: mocks.apiRequest }),
}));

vi.mock("@/stores/ollama/socket", () => ({
  createSocketClient: (options: typeof mocks.socketOptions) => {
    mocks.socketOptions = options;
    return {
      connect: mocks.connect,
      disconnect: mocks.disconnect,
      isOpen: mocks.isOpen,
      send: mocks.send,
    };
  },
  maxSocketPayloadChars: 24 * 1024 * 1024,
}));

vi.mock("@/stores/ollama/uploads", () => ({
  buildLocalAttachments: () => [],
  createObjectUrlTracker: () => ({
    revokeAll: vi.fn(),
    track: vi.fn(),
  }),
  uploadFiles: vi.fn(async () => ({
    content: "",
    images: [],
    attachments: [],
  })),
}));

import i18n from "@/i18n";
import { useOllamaStore } from "@/stores/ollama";

const alice = {
  id: 1,
  username: "alice",
  aboutMe: "",
  customBehavior: "",
  isAdmin: false,
  isOwner: false,
};

function chat(id: number, title = `Chat ${id}`) {
  return { id, title, createdAt: "2025-01-01T00:00:00.000Z" };
}

beforeEach(() => {
  setActivePinia(createPinia());
  localStorage.clear();
  i18n.global.locale.value = "en";
  mocks.connect.mockReset();
  mocks.disconnect.mockReset();
  mocks.isOpen.mockReset().mockReturnValue(true);
  mocks.send.mockReset();
  mocks.apiRequest.mockReset().mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/api/auth/login") return { user: alice, token: "session-token" };
    if (path === "/api/comfy/models") {
      return { models: ["checkpoint"], defaultNegativePrompt: "" };
    }
    if (path === "/api/chats" && options?.method === "POST") return { chatId: 2 };
    if (path === "/api/chats") return { chats: [chat(1)] };
    if (path === "/api/chats/1/messages") return { messages: [] };
    if (path === "/api/chats/2/messages") return { messages: [] };
    if (path === "/api/chats/2" && options?.method === "DELETE") return { deleted: true };
    throw new Error(`Unexpected API request: ${options?.method ?? "GET"} ${path}`);
  });
});

describe("Ollama frontend store", () => {
  it("stores authentication state and loads the user's chats", async () => {
    const store = useOllamaStore();
    await store.loginUser("alice", "password1");

    expect(store.user).toEqual(alice);
    expect(store.token).toBe("session-token");
    expect(localStorage.getItem("amadeus_token")).toBe("session-token");
    expect(store.activeChatId).toBe(1);
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it("does not connect a socket if the user logs out while initialization is pending", async () => {
    let finishChatLoad!: (value: { chats: ReturnType<typeof chat>[] }) => void;
    const chatLoad = new Promise<{ chats: ReturnType<typeof chat>[] }>((resolve) => {
      finishChatLoad = resolve;
    });
    mocks.apiRequest.mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === "/api/auth/login") return { user: alice, token: "session-token" };
      if (path === "/api/comfy/models") {
        return { models: ["checkpoint"], defaultNegativePrompt: "" };
      }
      if (path === "/api/chats" && options?.method === "POST") return { chatId: 2 };
      if (path === "/api/chats") return chatLoad;
      if (path === "/api/chats/2/messages") return { messages: [] };
      throw new Error(`Unexpected API request: ${options?.method ?? "GET"} ${path}`);
    });

    const store = useOllamaStore();
    const login = store.loginUser("alice", "password1");
    await vi.waitFor(() => expect(store.user).toEqual(alice));
    store.logout();
    finishChatLoad({ chats: [] });
    await login;

    expect(store.user).toBeNull();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("creates and deletes chats while updating active state", async () => {
    const store = useOllamaStore();
    store.chats = [chat(1), chat(2)];
    store.activeChatId = 1;

    await store.createNewChat();
    expect(store.chats[0]).toMatchObject({ id: 2, title: "New conversation" });
    expect(store.activeChatId).toBe(2);

    await store.deleteChat(2);
    expect(store.chats.map((item) => item.id)).toEqual([1]);
    expect(store.activeChatId).toBe(1);
    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/api/chats/2",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("appends streamed message chunks in order", () => {
    const store = useOllamaStore();
    store.isGenerating = true;
    mocks.socketOptions?.onMessage(
      JSON.stringify({
        type: "message",
        message: { content: "Hello " },
      }),
    );
    mocks.socketOptions?.onMessage(
      JSON.stringify({
        type: "message",
        message: { content: "world" },
      }),
    );
    mocks.socketOptions?.onMessage(JSON.stringify({ type: "done" }));

    expect(store.messageList).toHaveLength(1);
    expect(store.messageList[0]).toMatchObject({
      role: "assistant",
      content: "Hello world",
    });
    expect(store.isGenerating).toBe(false);
  });

  it("switches the active locale and resolves translated strings", () => {
    i18n.global.locale.value = "cs";
    expect(i18n.global.t("chat.newConversation")).toBe("Nová konverzace");
    i18n.global.locale.value = "en";
    expect(i18n.global.t("chat.newConversation")).toBe("New conversation");
  });

  it("adds a localized assistant error notification from the socket", () => {
    const store = useOllamaStore();
    mocks.socketOptions?.onMessage(
      JSON.stringify({
        type: "error",
        error: "AI service unavailable",
        localizationCode: "UNKNOWN_TEST_ERROR",
      }),
    );

    expect(store.messageList.at(-1)).toMatchObject({
      role: "assistant",
      content: "Something went wrong: AI service unavailable",
    });
    expect(store.isGenerating).toBe(false);
  });
});
