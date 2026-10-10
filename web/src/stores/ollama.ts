import { ref } from "vue";
import { defineStore } from "pinia";

type ModelValue = string | { name?: string };

type ModelMessage = {
  type: "models";
  models?: ModelValue[];
};

type AssistantMessage = {
  type: "message";
  message: {
    content?: string;
  };
};

type ErrorMessage = {
  type: "error";
  error: string;
};

type ServerMessage =
  | ModelMessage
  | AssistantMessage
  | ErrorMessage
  | { type: "authenticated"; user: User }
  | { type: "done" };

export type User = {
  id: number;
  username: string;
};

export type Chat = {
  id: number;
  title: string;
  createdAt: string;
};

type SavedMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model?: string;
  createdAt: string;
};

const apiBase = `http://${window.location.hostname}:8080`;

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  time: string;
  model?: string;
};

export const useOllamaStore = defineStore("ollama", () => {
  const user = ref<User | null>(null);
  const token = ref(localStorage.getItem("amadeus_token"));
  const chats = ref<Chat[]>([]);
  const activeChatId = ref<number | null>(null);
  const authLoading = ref(false);
  const authError = ref("");
  const models = ref<string[]>([]);
  const selectedModel = ref("");
  const draft = ref("");
  const isGenerating = ref(false);
  const tsundere = ref(false);
  const thinking = ref(false);
  const streaming = ref(true);
  const messageList = ref<ChatMessage[]>([]);

  let socket: WebSocket | null = null;

  async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    if (token.value) headers.set("Authorization", `Bearer ${token.value}`);

    const response = await fetch(`${apiBase}${path}`, { ...options, headers });
    const body = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Request failed.");
    return body;
  }

  function storeSession(sessionToken: string, sessionUser: User) {
    token.value = sessionToken;
    user.value = sessionUser;
    localStorage.setItem("amadeus_token", sessionToken);
  }

  function connectSocket() {
    if (!token.value || socket) return;
    socket = new WebSocket(`ws://${window.location.hostname}:8080`);
    socket.addEventListener("open", () => {
      socket?.send(JSON.stringify({ type: "authenticate", token: token.value }));
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") receiveMessage(event.data);
    });
    socket.addEventListener("close", () => {
      socket = null;
    });
  }

  async function initializeAuth() {
    if (!token.value || user.value) return;
    authLoading.value = true;
    try {
      const response = await apiRequest<{ user: User }>("/api/auth/me");
      user.value = response.user;
      connectSocket();
      await loadChats();
    } catch {
      logout();
    } finally {
      authLoading.value = false;
    }
  }

  async function authenticate(
    path: "/api/auth/login" | "/api/auth/register",
    username: string,
    password: string,
  ) {
    authLoading.value = true;
    authError.value = "";
    try {
      const response = await apiRequest<{ token: string; user: User }>(path, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      storeSession(response.token, response.user);
      connectSocket();
      await loadChats();
    } catch (error) {
      authError.value = error instanceof Error ? error.message : "Authentication failed.";
      throw error;
    } finally {
      authLoading.value = false;
    }
  }

  function loginUser(username: string, password: string) {
    return authenticate("/api/auth/login", username, password);
  }

  function registerUser(username: string, password: string) {
    return authenticate("/api/auth/register", username, password);
  }

  function logout() {
    socket?.close();
    socket = null;
    user.value = null;
    token.value = null;
    chats.value = [];
    activeChatId.value = null;
    messageList.value = [];
    localStorage.removeItem("amadeus_token");
  }

  async function loadChats() {
    const response = await apiRequest<{ chats: Chat[] }>("/api/chats");
    chats.value = response.chats;
    if (chats.value.length === 0) {
      await createNewChat();
    } else {
      const firstChat = chats.value[0];
      if (firstChat) await selectChat(firstChat.id);
    }
  }

  async function createNewChat() {
    const response = await apiRequest<{ chatId: number }>("/api/chats", {
      method: "POST",
      body: JSON.stringify({ title: "New conversation" }),
    });
    const chat: Chat = {
      id: response.chatId,
      title: "New conversation",
      createdAt: new Date().toISOString(),
    };
    chats.value = [chat, ...chats.value];
    activeChatId.value = chat.id;
    messageList.value = [];
  }

  async function selectChat(chatId: number) {
    const response = await apiRequest<{ messages: SavedMessage[] }>(
      `/api/chats/${chatId}/messages`,
    );
    activeChatId.value = chatId;
    messageList.value = response.messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      model: message.model,
      time: new Date(message.createdAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    }));
  }

  function setModels(values: ModelValue[]) {
    const nextModels = values
      .map((model) => (typeof model === "string" ? model : (model.name ?? "")))
      .filter((model): model is string => Boolean(model));

    models.value = [...new Set(nextModels)];
    if (!selectedModel.value || !models.value.includes(selectedModel.value)) {
      selectedModel.value = models.value[0] ?? "";
    }
  }

  function receiveMessage(rawMessage: string) {
    try {
      const message = JSON.parse(rawMessage) as ServerMessage;
      if (message.type === "models" && Array.isArray(message.models)) {
        setModels(message.models);
      } else if (message.type === "authenticated") {
        socket?.send(JSON.stringify({ type: "fetch_models" }));
      } else if (message.type === "message") {
        const content = message.message.content ?? "";
        addAssistantMessage(content);
      } else if (message.type === "error") {
        isGenerating.value = false;
        addAssistantMessage(`Error: ${message.error}`);
      } else if (message.type === "done") {
        isGenerating.value = false;
      }
    } catch {
      // Ignore non-JSON socket messages so the chat remains available.
    }
  }

  function addAssistantMessage(content: string) {
    const lastMessage = messageList.value.at(-1);

    if (lastMessage?.role === "assistant" && isGenerating.value) {
      lastMessage.content += content;
    } else {
      messageList.value.push({
        id: Date.now(),
        role: "assistant",
        content,
        time: "now",
        model: selectedModel.value,
      });
    }
  }

  function selectPrompt(prompt: string) {
    draft.value = prompt;
  }

  function clearMessages() {
    messageList.value = [];
  }

  function sendMessage() {
    const content = draft.value.trim();
    if (
      !content ||
      !activeChatId.value ||
      isGenerating.value ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    )
      return;

    messageList.value.push({
      id: Date.now(),
      role: "user",
      content,
      time: "now",
    });
    draft.value = "";
    isGenerating.value = true;

    socket.send(
      JSON.stringify({
        type: "message",
        chatId: activeChatId.value,
        model: selectedModel.value,
        prompt: content,
        tsundere: tsundere.value,
        thinking: thinking.value,
        stream: streaming.value,
      }),
    );
  }

  return {
    user,
    token,
    chats,
    activeChatId,
    authLoading,
    authError,
    models,
    selectedModel,
    draft,
    isGenerating,
    tsundere,
    thinking,
    streaming,
    messageList,
    setModels,
    receiveMessage,
    selectPrompt,
    clearMessages,
    sendMessage,
    initializeAuth,
    loginUser,
    registerUser,
    logout,
    loadChats,
    createNewChat,
    selectChat,
  };
});
