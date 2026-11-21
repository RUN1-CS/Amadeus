// Pinia store for auth, chat state, socket streaming, and model selection.
import { ref, watch } from "vue";
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
const tokenStorageKey = "amadeus_token";
const sidebarStorageKey = "amadeus_sidebar";
const selectedModelStorageKey = "amadeus_selected_model";
const selectedComfyModelStorageKey = "amadeus_selected_comfy_model";

// Keep below the server's WebSocket maxPayload (25 MiB) so a big image upload
// shows an error instead of silently dropping the connection.
const maxSocketPayloadChars = 24 * 1024 * 1024;
const maxReconnectDelayMs = 30_000;

// Created once: building a formatter per message is slow for long chats.
const timeFormat = new Intl.DateTimeFormat([], {
  hour: "numeric",
  minute: "2-digit",
});

type UploadKind = "image" | "pdf" | "file";
type UploadResult = {
  content: string;
  images: string[];
  attachments: { name: string; kind: UploadKind }[];
};

// WebSocket endpoint: VITE_WS_URL wins, otherwise match the page's protocol (wss on https).
function socketUrl() {
  const configured = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_WS_URL;
  if (configured) return configured;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.hostname}:8080`;
}

export const useOllamaStore = defineStore("ollama", () => {
  const user = ref<User | null>(null);
  const token = ref(localStorage.getItem(tokenStorageKey));
  const chats = ref<Chat[]>([]);
  const activeChatId = ref<number | null>(null);
  const sidebarVisible = ref(localStorage.getItem(sidebarStorageKey) !== "hidden");
  const authLoading = ref(false);
  const authError = ref("");
  const models = ref<string[]>([]);
  const selectedModel = ref(localStorage.getItem(selectedModelStorageKey) ?? "");
  const comfyModels = ref<string[]>([]);
  const selectedComfyModel = ref(localStorage.getItem(selectedComfyModelStorageKey) ?? "");
  const defaultNegativePrompt = ref("");
  const draft = ref("");
  const isGenerating = ref(false);
  const tsundere = ref(false);
  const thinking = ref(false);
  const streaming = ref(true);
  const messageList = ref<ChatMessage[]>([]);
  const api = createApiClient(() => token.value);

  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;

  // Chat that the in-flight reply belongs to, so streamed text never lands in another chat.
  let generatingChatId: number | null = null;
  // Incremented per chat switch so a slow response can't overwrite a newer one.
  let selectRequestId = 0;

  // Streamed chunks are buffered and applied once per frame instead of once per token.
  let pendingContent = "";
  let pendingThinking = "";
  let flushHandle: number | null = null;

  // Blob URLs created for outgoing attachments; revoked when the message list is replaced.
  const objectUrls = new Set<string>();

  watch(selectedModel, (model) => {
    localStorage.setItem(selectedModelStorageKey, model);
  });
  watch(selectedComfyModel, (model) => {
    localStorage.setItem(selectedComfyModelStorageKey, model);
  });

  function revokeObjectUrls() {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  }

  function isSocketOpen() {
    return socket !== null && socket.readyState === WebSocket.OPEN;
  }

  // Save the auth token and user object after a successful login or signup.
  function storeSession(sessionToken: string, sessionUser: User) {
    token.value = sessionToken;
    user.value = sessionUser;
    localStorage.setItem(tokenStorageKey, sessionToken);
  }

  // Retry a dropped connection with exponential backoff while a session exists.
  function scheduleReconnect() {
    if (!token.value) return;
    const delay = Math.min(maxReconnectDelayMs, 1_000 * 2 ** reconnectAttempts);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(connectSocket, delay);
  }

  // Open the WebSocket and authenticate it when the browser has a valid token.
  function connectSocket() {
    if (!token.value || socket) return;
    clearTimeout(reconnectTimer);

    const ws = new WebSocket(socketUrl());
    socket = ws;
    ws.addEventListener("open", () => {
      reconnectAttempts = 0;
      ws.send(JSON.stringify({ type: "authenticate", token: token.value }));
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") receiveMessage(event.data);
    });
    ws.addEventListener("close", () => {
      // A socket that was replaced or closed on purpose (logout) must not reconnect.
      if (socket !== ws) return;
      socket = null;
      if (isGenerating.value) {
        flushPending();
        isGenerating.value = false;
        generatingChatId = null;
        addAssistantMessage("Error: Connection lost. Reconnecting…");
      }
      scheduleReconnect();
    });
  }

  // Restore the active session during app startup and load the user's chats.
  async function initializeAuth() {
    if (!token.value || user.value) return;
    authLoading.value = true;
    try {
      try {
        const response = await api.request<{ user: User }>("/api/auth/me");
        user.value = response.user;
      } catch {
        logout();
        return;
      }
      connectSocket();
      try {
        // Independent requests: run them together.
        await Promise.all([loadComfyModels(), loadChats()]);
      } catch (error) {
        // The session is valid here, so a failed chat load shouldn't sign the user out.
        console.error("Failed to load chats", error);
      }
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
      await Promise.all([loadComfyModels(), loadChats()]);
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
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    const closing = socket;
    socket = null; // detach first so the close handler doesn't try to reconnect
    closing?.close();

    if (flushHandle !== null) cancelAnimationFrame(flushHandle);
    flushHandle = null;
    pendingContent = "";
    pendingThinking = "";
    generatingChatId = null;
    isGenerating.value = false;

    selectRequestId += 1;
    revokeObjectUrls();
    user.value = null;
    token.value = null;
    chats.value = [];
    activeChatId.value = null;
    messageList.value = [];
    localStorage.removeItem(tokenStorageKey);
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
    selectRequestId += 1; // cancel any chat switch still in flight
    revokeObjectUrls();
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
    localStorage.setItem(sidebarStorageKey, visible ? "visible" : "hidden");
  }

  // Fetch the message history for a chat and render it in the main window.
  async function selectChat(chatId: number) {
    const requestId = ++selectRequestId;
    const response = await api.request<{ messages: SavedMessage[] }>(
      `/api/chats/${chatId}/messages`,
    );
    // The user picked another chat while this one was loading; drop the stale result.
    if (requestId !== selectRequestId) return;

    revokeObjectUrls();
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
        time: timeFormat.format(new Date(message.createdAt)),
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

  async function loadComfyModels() {
    try {
      const response = await api.request<{
        models: string[];
        defaultNegativePrompt: string;
      }>("/api/comfy/models");
      comfyModels.value = response.models;
      defaultNegativePrompt.value = response.defaultNegativePrompt;
      if (!selectedComfyModel.value || !comfyModels.value.includes(selectedComfyModel.value)) {
        selectedComfyModel.value = comfyModels.value[0] ?? "";
      }
    } catch (error) {
      console.error("Could not load ComfyUI models:", error);
    }
  }

  // Buffer a streamed chunk and apply it on the next animation frame.
  function queueChunk(content: string, thinkingContent: string) {
    pendingContent += content;
    pendingThinking += thinkingContent;
    if (flushHandle === null) flushHandle = requestAnimationFrame(flushPending);
  }

  // Apply any buffered chunks now. Called before every non-chunk event to keep ordering.
  function flushPending() {
    if (flushHandle !== null) {
      cancelAnimationFrame(flushHandle);
      flushHandle = null;
    }
    if (!pendingContent && !pendingThinking) return;
    const content = pendingContent;
    const thinkingContent = pendingThinking;
    pendingContent = "";
    pendingThinking = "";
    addAssistantMessage(content, thinkingContent);
  }

  // True when a streamed reply belongs to a chat the user has navigated away from.
  function isForOtherChat() {
    return generatingChatId !== null && generatingChatId !== activeChatId.value;
  }

  // Handle socket events like model updates, streamed content, and errors.
  function receiveMessage(rawMessage: string) {
    let message: ServerMessage;
    try {
      message = JSON.parse(rawMessage) as ServerMessage;
    } catch {
      // Ignore non-JSON socket messages so the chat remains available.
      return;
    }

    // Plain streamed chunks take the cheap buffered path.
    if (message.type === "message" && !message.full && !message.message.attachments?.length) {
      if (isForOtherChat()) return;
      queueChunk(message.message.content ?? "", message.message.thinking ?? "");
      return;
    }

    flushPending();

    if (message.type === "models" && Array.isArray(message.models)) {
      setModels(message.models);
    } else if (message.type === "authenticated") {
      socket?.send(JSON.stringify({ type: "fetch_models" }));
    } else if (message.type === "message") {
      if (isForOtherChat()) return;
      addAssistantMessage(
        message.message.content ?? "",
        message.message.thinking ?? "",
        message.full ?? false,
        message.message.attachments,
      );
    } else if (message.type === "chat_title") {
      chats.value = chats.value.map((chat) => (chat.id === message.chat.id ? message.chat : chat));
    } else if (message.type === "error") {
      isGenerating.value = false;
      generatingChatId = null;
      addAssistantMessage(`Error: ${message.error}`);
    } else if (message.type === "done") {
      isGenerating.value = false;
      generatingChatId = null;
    }
  }

  // Append streamed assistant output to the current message or create a new one.
  function addAssistantMessage(
    content: string,
    thinkingContent = "",
    isFull = false,
    attachments: ChatMessage["attachments"] = [],
  ) {
    const lastMessage = messageList.value.at(-1);

    if (lastMessage?.role === "assistant" && isGenerating.value) {
      if (isFull) {
        lastMessage.content = content;
        lastMessage.thinking = thinkingContent;
      } else {
        lastMessage.content += content;
        lastMessage.thinking = (lastMessage.thinking ?? "") + thinkingContent;
      }
      if (attachments.length) lastMessage.attachments = attachments;
    } else {
      messageList.value.push({
        id: Date.now(),
        role: "assistant",
        content,
        thinking: thinkingContent,
        time: "now",
        model: selectedModel.value,
        attachments,
      });
    }
  }

  // Put a preset prompt into the composer for quick reuse.
  function selectPrompt(prompt: string) {
    draft.value = prompt;
  }

  // Empty the currently visible message list.
  function clearMessages() {
    revokeObjectUrls();
    messageList.value = [];
  }

  // Show a local error in the conversation without touching the generating state.
  function showError(error: unknown, fallback: string) {
    addAssistantMessage(`Error: ${error instanceof Error ? error.message : fallback}`);
  }

  // Send the current draft to the active chat over the authenticated socket.
  async function sendMessage(attachments: FileList | null = null) {
    const content = draft.value.trim();
    const files = attachments?.length ? attachments : null;
    const chatId = activeChatId.value;
    if ((!content && !files) || !chatId || isGenerating.value || !isSocketOpen()) return false;

    // Block double submits while files are uploading, not just while the model replies.
    isGenerating.value = true;

    let uploaded: UploadResult;
    try {
      uploaded = await uploadFiles(chatId, files);
    } catch (error) {
      // Do not send a message that refers to files the server did not receive.
      isGenerating.value = false;
      showError(error, "Upload failed.");
      return false;
    }

    const payload = JSON.stringify({
      type: "message",
      chatId,
      model: selectedModel.value,
      prompt: [content, uploaded.content].filter(Boolean).join("\n\n"),
      images: uploaded.images,
      attachments: uploaded.attachments,
      generativeModel: selectedComfyModel.value,
      tsundere: tsundere.value,
      thinking: thinking.value,
      stream: streaming.value,
    });

    if (payload.length > maxSocketPayloadChars) {
      isGenerating.value = false;
      showError(
        null,
        "Those attachments are too large to send together. Try fewer or smaller images.",
      );
      return false;
    }

    // The socket may have dropped while the upload was running.
    const activeSocket = socket;
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
      isGenerating.value = false;
      showError(null, "Connection lost. Please try again in a moment.");
      return false;
    }

    messageList.value.push({
      id: Date.now(),
      role: "user",
      content,
      time: "now",
      attachments: Array.from(files ?? []).map((file, index) => {
        const url = URL.createObjectURL(file);
        objectUrls.add(url);
        return {
          name: file.name,
          url,
          lastModified: file.lastModified,
          kind:
            uploaded.attachments[index]?.kind ??
            (file.type.startsWith("image/")
              ? "image"
              : file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
                ? "pdf"
                : "file"),
        };
      }),
    });
    draft.value = "";
    generatingChatId = chatId;
    activeSocket.send(payload);

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

  // Upload document and image files to the server for model ingestion.
  async function uploadFiles(chatId: number, files: FileList | null): Promise<UploadResult> {
    const result: UploadResult = { content: "", images: [], attachments: [] };
    if (!files?.length) return result;

    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    const response = await api.request<{
      files: {
        name: string;
        content?: string;
        kind: UploadKind;
        data?: string;
      }[];
    }>(`/api/chats/${chatId}/upload`, { method: "POST", body: formData });

    const textBlocks: string[] = [];
    for (const file of response.files) {
      result.attachments.push({ name: file.name, kind: file.kind });
      if (file.kind === "image") {
        if (file.data) result.images.push(file.data);
      } else {
        textBlocks.push(`File: ${file.name}\n\`\`\`\n${file.content ?? ""}\n\`\`\``);
      }
    }
    result.content = textBlocks.join("\n\n");
    return result;
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
    comfyModels,
    selectedComfyModel,
    defaultNegativePrompt,
    messageList,
    setModels,
    loadComfyModels,
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
