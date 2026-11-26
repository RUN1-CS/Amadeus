// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Pinia store for auth, chat state, socket streaming, and model selection.
import { ref, watch } from "vue";
import { defineStore } from "pinia";

import { createApiClient } from "@/services/api";
import i18n from "@/i18n";
import { localizeServerError } from "@/services/serverErrors";
import type {
  Chat,
  ChatMessage,
  ModelValue,
  SavedMessage,
  User,
  ServerMessage,
} from "@/types/chat";
import { mapSavedMessages } from "./ollama/messages";
import { createSocketClient, maxSocketPayloadChars } from "./ollama/socket";
import {
  loadSelectedOptions,
  selectedComfyModelStorageKey,
  selectedModelStorageKey,
  selectedOptionsStorageKey,
  sidebarStorageKey,
  tokenStorageKey,
} from "./ollama/storage";
import { createChunkBuffer } from "./ollama/streamBuffer";
import {
  buildLocalAttachments,
  createObjectUrlTracker,
  uploadFiles,
  type UploadResult,
} from "./ollama/uploads";

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
  const comfyStatus = ref<"checking" | "connected" | "unavailable">("checking");
  const selectedComfyModel = ref(localStorage.getItem(selectedComfyModelStorageKey) ?? "");
  const selectedOptions = ref(loadSelectedOptions());
  const defaultNegativePrompt = ref("");
  const draft = ref("");
  const isGenerating = ref(false);
  const messageList = ref<ChatMessage[]>([]);
  const api = createApiClient(() => token.value);

  // Chat that the in-flight reply belongs to, so streamed text never lands in another chat.
  let generatingChatId: number | null = null;
  // Incremented per chat switch so a slow response can't overwrite a newer one.
  let selectRequestId = 0;

  const objectUrls = createObjectUrlTracker();
  const chunks = createChunkBuffer((content, thinking) => addAssistantMessage(content, thinking));
  const socket = createSocketClient({
    getToken: () => token.value,
    onMessage: receiveMessage,
    onUnexpectedClose: handleSocketClose,
  });

  watch(selectedModel, (model) => {
    localStorage.setItem(selectedModelStorageKey, model);
  });
  watch(selectedComfyModel, (model) => {
    localStorage.setItem(selectedComfyModelStorageKey, model);
  });
  watch(
    selectedOptions,
    (options) => {
      localStorage.setItem(selectedOptionsStorageKey, JSON.stringify(options));
    },
    { deep: true },
  );

  // Save the auth token and user object after a successful login or signup.
  function storeSession(sessionToken: string, sessionUser: User) {
    token.value = sessionToken;
    user.value = sessionUser;
    localStorage.setItem(tokenStorageKey, sessionToken);
  }

  // A dropped connection mid-reply ends the reply with an error; the client reconnects itself.
  function handleSocketClose() {
    if (!isGenerating.value) return;
    chunks.flush();
    isGenerating.value = false;
    generatingChatId = null;
    addAssistantMessage(i18n.global.t("chat.connectionLostReconnecting"));
  }

  // Restore the active session during app startup and load the user's chats.
  async function initializeAuth() {
    if (!token.value || user.value) return;
    const sessionToken = token.value;
    authLoading.value = true;
    try {
      try {
        const response = await api.request<{ user: User }>("/api/auth/me");
        user.value = response.user;
      } catch {
        logout();
        return;
      }
      try {
        // Independent requests: run them together.
        await Promise.all([loadComfyModels(), loadChats()]);
      } catch (error) {
        // The session is valid here, so a failed chat load shouldn't sign the user out.
        console.error("Failed to load chats", error);
      }
      if (token.value === sessionToken && user.value) socket.connect();
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
      await Promise.all([loadComfyModels(), loadChats()]);
      if (token.value === response.token && user.value) socket.connect();
    } catch (error) {
      authError.value =
        error instanceof Error ? error.message : i18n.global.t("auth.authenticationFailed");
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

  async function deleteCurrentAccount(currentPassword: string) {
    await api.request<{ deleted: boolean }>("/api/auth/delete", {
      method: "POST",
      body: JSON.stringify({ currentPassword }),
    });
    logout();
  }

  // Clear the in-memory session and close the socket when the user signs out.
  function logout() {
    socket.disconnect();
    chunks.reset();
    generatingChatId = null;
    isGenerating.value = false;

    selectRequestId += 1;
    objectUrls.revokeAll();
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
      body: JSON.stringify({ title: i18n.global.t("chat.newConversation") }),
    });
    const chat: Chat = {
      id: response.chatId,
      title: i18n.global.t("chat.newConversation"),
      createdAt: new Date().toISOString(),
    };
    selectRequestId += 1; // cancel any chat switch still in flight
    objectUrls.revokeAll();
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

    objectUrls.revokeAll();
    activeChatId.value = chatId;
    messageList.value = mapSavedMessages(response.messages);
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
    comfyStatus.value = "checking";
    try {
      const response = await api.request<{
        models: string[];
        defaultNegativePrompt: string;
      }>("/api/comfy/models");
      comfyModels.value = response.models;
      comfyStatus.value = response.models.length > 0 ? "connected" : "unavailable";
      defaultNegativePrompt.value = response.defaultNegativePrompt;
      if (!selectedComfyModel.value || !comfyModels.value.includes(selectedComfyModel.value)) {
        selectedComfyModel.value = comfyModels.value[0] ?? "";
      }
    } catch (error) {
      comfyModels.value = [];
      comfyStatus.value = "unavailable";
      console.error("Could not load ComfyUI models:", error);
    }
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
      chunks.queue(message.message.content ?? "", message.message.thinking ?? "");
      return;
    }

    chunks.flush();

    if (message.type === "models" && Array.isArray(message.models)) {
      setModels(message.models);
    } else if (message.type === "authenticated") {
      socket.send(JSON.stringify({ type: "fetch_models" }));
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
      addAssistantMessage(
        i18n.global.t("chat.errorPrefix", {
          message: localizeServerError(message),
        }),
      );
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
        time: i18n.global.t("chat.now"),
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
    objectUrls.revokeAll();
    messageList.value = [];
  }

  // Show a local error in the conversation without touching the generating state.
  function showError(error: unknown, fallback: string) {
    addAssistantMessage(
      i18n.global.t("chat.errorPrefix", {
        message: error instanceof Error ? error.message : fallback,
      }),
    );
  }

  // Send the current draft to the active chat over the authenticated socket.
  async function sendMessage(attachments: FileList | null = null) {
    const content = draft.value.trim();
    const files = attachments?.length ? attachments : null;
    const chatId = activeChatId.value;
    if ((!content && !files) || !chatId || isGenerating.value || !socket.isOpen()) return false;

    // Block double submits while files are uploading, not just while the model replies.
    isGenerating.value = true;

    let uploaded: UploadResult;
    try {
      uploaded = await uploadFiles(api, chatId, files);
    } catch (error) {
      // Do not send a message that refers to files the server did not receive.
      isGenerating.value = false;
      showError(error, i18n.global.t("chat.uploadFailed"));
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
      tsundere: selectedOptions.value.tsundere,
      thinking: selectedOptions.value.thinking,
      stream: selectedOptions.value.streaming,
    });

    if (payload.length > maxSocketPayloadChars) {
      isGenerating.value = false;
      showError(null, i18n.global.t("chat.attachmentsTooLarge"));
      return false;
    }

    // The socket may have dropped while the upload was running.
    if (!socket.isOpen()) {
      isGenerating.value = false;
      showError(null, i18n.global.t("chat.connectionLostRetry"));
      return false;
    }

    messageList.value.push({
      id: Date.now(),
      role: "user",
      content,
      time: i18n.global.t("chat.now"),
      attachments: buildLocalAttachments(files, uploaded, objectUrls),
    });
    draft.value = "";
    generatingChatId = chatId;
    socket.send(payload);

    return true;
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
    selectedOptions,
    draft,
    isGenerating,
    comfyModels,
    comfyStatus,
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
    deleteCurrentAccount,
    logout,
    loadChats,
    createNewChat,
    deleteChat,
    renameChat,
    selectChat,
    setSidebarVisible,
  };
});
