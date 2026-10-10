import { ref } from "vue";
import { defineStore } from "pinia";

import { createApiClient } from "../services/api";
import type { Chat, ChatMessage, ModelValue, SavedMessage, User } from "../types/chat";

type ModelMessage = {
  type: "models";
  models?: ModelValue[];
};

type AssistantMessage = {
  type: "message";
  message: {
    content?: string;
    thinking?: string;
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

export const useOllamaStore = defineStore("ollama", () => {
  const user = ref<User | null>(null);
  const token = ref(localStorage.getItem("amadeus_token"));
  const chats = ref<Chat[]>([]);
  const activeChatId = ref<number | null>(null);
  const sidebarVisible = ref(localStorage.getItem("amadeus_sidebar") !== "hidden");
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
  const api = createApiClient(() => token.value);

  let socket: WebSocket | null = null;

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
      const response = await api.request<{ user: User }>("/api/auth/me");
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
      const response = await api.request<{ token: string; user: User }>(path, {
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

  async function updateAccount(
    username: string,
    currentPassword: string,
    newPassword = "",
    aboutMe = "",
    customBehavior = "",
  ) {
    const response = await api.request<{ user: User }>("/api/auth/account", {
      method: "PATCH",
      body: JSON.stringify({
        username,
        currentPassword,
        newPassword,
        aboutMe,
        customBehavior,
      }),
    });
    user.value = response.user;
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
    const response = await api.request<{ chats: Chat[] }>("/api/chats");
    chats.value = response.chats;
    if (chats.value.length === 0) {
      await createNewChat();
    } else {
      const firstChat = chats.value[0];
      if (firstChat) await selectChat(firstChat.id);
    }
  }

  async function createNewChat() {
    const response = await api.request<{ chatId: number }>("/api/chats", {
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

  async function deleteChat(chatId: number) {
    await api.request<{ deleted: boolean }>(`/api/chats/${chatId}`, {
      method: "DELETE",
    });
    chats.value = chats.value.filter((chat) => chat.id !== chatId);
    if (activeChatId.value === chatId) {
      const nextChat = chats.value[0];
      if (nextChat) await selectChat(nextChat.id);
      else await createNewChat();
    }
  }

  async function renameChat(chatId: number, title: string) {
    const response = await api.request<{ chat: Chat }>(`/api/chats/${chatId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    chats.value = chats.value.map((chat) => (chat.id === chatId ? response.chat : chat));
  }

  function setSidebarVisible(visible: boolean) {
    sidebarVisible.value = visible;
    localStorage.setItem("amadeus_sidebar", visible ? "visible" : "hidden");
  }

  async function selectChat(chatId: number) {
    const response = await api.request<{ messages: SavedMessage[] }>(
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
        addAssistantMessage(content, message.message.thinking ?? "");
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

  function addAssistantMessage(content: string, thinkingContent = "") {
    const lastMessage = messageList.value.at(-1);

    if (lastMessage?.role === "assistant" && isGenerating.value) {
      lastMessage.content += content;
      lastMessage.thinking = (lastMessage.thinking ?? "") + thinkingContent;
    } else {
      messageList.value.push({
        id: Date.now(),
        role: "assistant",
        content,
        thinking: thinkingContent,
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
    sidebarVisible,
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
    updateAccount,
    logout,
    loadChats,
    createNewChat,
    deleteChat,
    renameChat,
    selectChat,
    setSidebarVisible,
  };
});
