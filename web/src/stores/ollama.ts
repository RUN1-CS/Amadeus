// Pinia store for auth, chat state, socket streaming, and model selection.
import { ref } from "vue";
import { defineStore } from "pinia";

import { createApiClient } from "@/services/api";
import type {
  Chat,
  ChatMessage,
  ModelValue,
  SavedMessage,
  User,
  ServerMessage,
} from "../types/chat";

const FILE_BLOCK = /(?:^|\n\n)File: ([^\n]+)\n```\n([\s\S]*?)\n```(?=\n\nFile: |$)/g;

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

  // Save the auth token and user object after a successful login or signup.
  function storeSession(sessionToken: string, sessionUser: User) {
    token.value = sessionToken;
    user.value = sessionUser;
    localStorage.setItem("amadeus_token", sessionToken);
  }

  // Open the WebSocket and authenticate it when the browser has a valid token.
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

  // Restore the active session during app startup and load the user's chats.
  async function initializeAuth() {
    if (!token.value || user.value) return;
    authLoading.value = true;
    try {
      const response = await api.request<{ user: User }>("/api/auth/me");
      user.value = response.user;
      connectSocket();
      try {
        await loadChats();
      } catch (error) {
        console.error("Failed to load chats", error);
      }
      await loadChats();
    } catch {
      logout();
    } finally {
      authLoading.value = false;
    }
  }

  // Sign the user in or create a new account from the form data.
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

  // Convenience wrapper for the login route.
  function loginUser(username: string, password: string) {
    return authenticate("/api/auth/login", username, password);
  }

  // Convenience wrapper for the registration route.
  function registerUser(username: string, password: string) {
    return authenticate("/api/auth/register", username, password);
  }

  // Update the profile and preferences from the settings screen.
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

  // Clear the in-memory session and close the socket when the user signs out.
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

  // Load the user's saved conversations and select the first one if present.
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

  // Create a new blank conversation and make it the active one.
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

  // Remove the selected conversation and move to a new one if this one was active.
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

  // Rename an existing chat and refresh the sidebar title.
  async function renameChat(chatId: number, title: string) {
    const response = await api.request<{ chat: Chat }>(`/api/chats/${chatId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    chats.value = chats.value.map((chat) => (chat.id === chatId ? response.chat : chat));
  }

  // Persist the sidebar state and reflect it in the UI.
  function setSidebarVisible(visible: boolean) {
    sidebarVisible.value = visible;
    localStorage.setItem("amadeus_sidebar", visible ? "visible" : "hidden");
  }

  // Fetch the message history for a chat and render it in the main window.
  async function selectChat(chatId: number) {
    const response = await api.request<{ messages: SavedMessage[] }>(
      `/api/chats/${chatId}/messages`,
    );
    activeChatId.value = chatId;
    messageList.value = response.messages.map((message) => {
      const raw = message.content ?? "";
      const parsed = message.role === "user" ? splitSavedContent(raw) : null;
      const saved = message.attachments ?? [];
      const extracted = (parsed?.files ?? []).map((file) => ({
        ...saved.find((s) => s.name === file.name),
        ...file,
      }));

      return {
        id: message.id,
        role: message.role,
        content: parsed ? parsed.text : raw,
        model: message.model,
        time: new Date(message.createdAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        }),
        attachments: extracted.length ? extracted : saved,
      };
    });
  }

  // Normalize the server's model list and preserve the current selection if still valid.
  function setModels(values: ModelValue[]) {
    const nextModels = values
      .map((model) => (typeof model === "string" ? model : (model.name ?? "")))
      .filter((model): model is string => Boolean(model));

    models.value = [...new Set(nextModels)];
    if (!selectedModel.value || !models.value.includes(selectedModel.value)) {
      selectedModel.value = models.value[0] ?? "";
    }
  }

  // Handle socket events like model updates, streamed content, and errors.
  function receiveMessage(rawMessage: string) {
    try {
      const message = JSON.parse(rawMessage) as ServerMessage;
      if (message.type === "models" && Array.isArray(message.models)) {
        setModels(message.models);
      } else if (message.type === "authenticated") {
        socket?.send(JSON.stringify({ type: "fetch_models" }));
      } else if (message.type === "message") {
        const content = message.message.content ?? "";
        addAssistantMessage(content, message.message.thinking ?? "", message.full ?? false);
      } else if (message.type === "chat_title") {
        chats.value = chats.value.map((chat) =>
          chat.id === message.chat.id ? message.chat : chat,
        );
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

  // Append streamed assistant output to the current message or create a new one.
  function addAssistantMessage(content: string, thinkingContent = "", isFull = false) {
    const lastMessage = messageList.value.at(-1);

    if (lastMessage?.role === "assistant" && isGenerating.value) {
      lastMessage.content += content;
      lastMessage.thinking = (lastMessage.thinking ?? "") + thinkingContent;

      if (isFull) {
        lastMessage.content = content;
        lastMessage.thinking = thinkingContent;
      }
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

  // Put a preset prompt into the composer for quick reuse.
  function selectPrompt(prompt: string) {
    draft.value = prompt;
  }

  // Empty the currently visible message list.
  function clearMessages() {
    messageList.value = [];
  }

  // Send the current draft to the active chat over the authenticated socket.
  async function sendMessage(attachments: FileList | null = null) {
    const content = draft.value.trim();
    const hasAttachments = Boolean(attachments?.length);
    const chatId = activeChatId.value;
    if (
      (!content && !hasAttachments) ||
      !chatId ||
      isGenerating.value ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    )
      return false;

    let uploadedContent = "";
    try {
      uploadedContent = await uploadFiles(chatId, attachments);
    } catch {
      // Do not send a message that refers to files the server did not receive.
      return false;
    }

    messageList.value.push({
      id: Date.now(),
      role: "user",
      content,
      time: "now",
      attachments: Array.from(attachments || []).map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
      })),
    });
    draft.value = "";
    isGenerating.value = true;

    socket.send(
      JSON.stringify({
        type: "message",
        chatId,
        model: selectedModel.value,
        prompt: [content, uploadedContent].filter(Boolean).join("\n\n"),
        tsundere: tsundere.value,
        thinking: thinking.value,
        stream: streaming.value,
      }),
    );

    return true;
  }

  function splitSavedContent(raw: string) {
    const files: { name: string; content: string }[] = [];
    const text = raw
      .replace(FILE_BLOCK, (_match, name: string, content: string) => {
        files.push({ name, content });
        return "";
      })
      .trim();
    return { text, files };
  }

  // Upload text document files to the server for model ingestion.
  async function uploadFiles(chatId: number, files: FileList | null) {
    if (!files?.length) return "";

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    const response = await api.request<{ files: { name: string; content: string }[] }>(
      `/api/chats/${chatId}/upload`,
      { method: "POST", body: formData },
    );
    return response.files
      .map((file) => `File: ${file.name}\n\`\`\`\n${file.content}\n\`\`\``)
      .join("\n\n");
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
