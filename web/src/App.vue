<!-- Main chat shell: sidebar, composer, message rendering, and route-aware auth checks. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch, watchEffect } from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import DOMPurify from "dompurify";
import { marked } from "marked";

import { useOllamaStore } from "./stores/ollama";
import { applyTheme, loadTheme } from "./services/theme";

applyTheme(loadTheme());

const ollamaStore = useOllamaStore();
const route = useRoute();
const router = useRouter();
const {
  user,
  authLoading,
  draft,
  isGenerating,
  messageList,
  tsundere,
  thinking,
  streaming,
  chats,
  activeChatId,
  sidebarVisible,
} = storeToRefs(ollamaStore);
const {
  selectPrompt,
  sendMessage,
  initializeAuth,
  createNewChat,
  deleteChat,
  renameChat,
  selectChat,
  setSidebarVisible,
  logout,
} = ollamaStore;

const activeChat = computed(() => chats.value.find((chat) => chat.id === activeChatId.value));
const chatScroll = ref<HTMLElement | null>(null);
const shouldFollowLatest = ref(true);
const renameChatId = ref<number | null>(null);
const renameValue = ref("");
const deleteChatId = ref<number | null>(null);
const deleteChatName = ref("");
const deleteConfirmation = ref("");
const attachmentInput = ref<HTMLInputElement | null>(null);
const attachments = ref<File[]>([]);
const attachmentContents = ref<Record<string, string>>({});
const expandedAttachments = ref<Record<string, boolean>>({});
const hiddenAttachments = ref<Record<string, boolean>>({});

// Composer actions are kept in one place so future tools can be added without
// coupling their controls to the message composer markup.
const composerActions = {
  attach: () => attachmentInput.value?.click(),
};

// Key helper to uniquely identify files in state maps
function getFileKey(file: { name: string; url?: string; content?: string; lastModified?: number }) {
  if ("url" in file && file.url) return `${file.name}:${file.url}`;
  if ("lastModified" in file && file.lastModified) return `${file.name}:${file.lastModified}`;
  if ("content" in file && file.content) return `${file.name}:${file.content.length}`;
  return file.name;
}

// Keep selected files visible and load their text previews
async function handleFileSelection(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;

  for (const file of files) {
    // Read text files for preview
    const text = await file.text();
    const key = getFileKey(file);
    attachmentContents.value[key] = text;
    expandedAttachments.value[key] = false;
    hiddenAttachments.value[key] = false;
  }

  attachments.value.push(...files);
  input.value = "";
}

// Remove attachment and clean up state
function removeAttachment(index: number) {
  const file = attachments.value[index];
  if (file) {
    const key = getFileKey(file);
    delete attachmentContents.value[key];
    delete expandedAttachments.value[key];
    delete hiddenAttachments.value[key];
  }
  attachments.value.splice(index, 1);
}

// Create a new FileList from the current attachments so it can be sent with the message.
function getAttachmentFileList(): FileList {
  const transfer = new DataTransfer();
  attachments.value.forEach((file) => transfer.items.add(file));
  return transfer.files;
}

// Get the 5-line preview text
function getPreviewText(
  file: File | { name: string; url?: string; content?: string; lastModified?: number },
): string {
  const text = getDisplayContent(file);
  if (!text) return "Loading content...";

  // Extract up to 3 lines
  const lines = text.split("\n").slice(0, 3).join("\n");
  const maxChars = 160;

  if (lines.length > maxChars) {
    return lines.slice(0, maxChars).trim() + "…";
  }

  if (text.length > lines.length) {
    return lines.trim() + "…";
  }

  return lines;
}

watch(
  messageList,
  (messages) => {
    for (const msg of messages) {
      if (msg.attachments?.length) {
        for (const file of msg.attachments) {
          void loadFileContentIfNeeded(file);
        }
      }
    }
  },
  { immediate: true, deep: true },
);

// Toggle expanded view
function toggleExpand(file: File | { name: string; url?: string; lastModified?: number }) {
  const key = getFileKey(file);
  expandedAttachments.value[key] = !expandedAttachments.value[key];
}

// Hide or show attachment card completely
function toggleHideAttachment(file: File | { name: string; url?: string; lastModified?: number }) {
  const key = getFileKey(file);
  hiddenAttachments.value[key] = !hiddenAttachments.value[key];
}

// Get file content from URL
async function fetchFileContent(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
  return await response.text();
}

// Store loaded file contents by key
const loadedContents = ref<Record<string, string>>({});

async function loadFileContentIfNeeded(file: {
  name: string;
  url?: string;
  lastModified?: number;
}) {
  const key = getFileKey(file);
  // Return cached version if already fetched
  if (attachmentContents.value[key]) return attachmentContents.value[key];
  if (loadedContents.value[key]) return loadedContents.value[key];

  // Fetch remote content asynchronously if URL exists
  if (file.url) {
    try {
      const content = await fetchFileContent(file.url);
      loadedContents.value[key] = content;
      return content;
    } catch (err) {
      console.error("Failed to fetch file content:", err);
      return "Failed to load content";
    }
  }

  return "";
}

// Clean display content getter with no side-effects
function getDisplayContent(file: {
  name: string;
  url?: string;
  content?: string;
  lastModified?: number;
}): string {
  const key = getFileKey(file);

  if ("content" in file && file.content) return file.content;
  if (attachmentContents.value[key]) return attachmentContents.value[key];
  if (loadedContents.value[key]) return loadedContents.value[key];

  // Trigger async fetch if url is available but content not yet cached
  if (file.url) {
    void loadFileContentIfNeeded(file);
  }

  return "";
}

// Open the rename editor for a sidebar chat and preload the current title.
function openRename(chat: { id: number; title: string }) {
  renameChatId.value = chat.id;
  renameValue.value = chat.title;
}

// Save the edited chat title and close the rename UI.
async function submitRename() {
  if (!renameChatId.value || !renameValue.value.trim()) return;
  await renameChat(renameChatId.value, renameValue.value);
  renameChatId.value = null;
}

// Prepare the delete flow with the conversation name for confirmation.
function openDelete(chat: { id: number; title: string }) {
  deleteChatId.value = chat.id;
  deleteChatName.value = chat.title;
  deleteConfirmation.value = "";
}

// Delete a chat only after the user types the exact title.
async function confirmDelete() {
  if (!deleteChatId.value || deleteConfirmation.value !== deleteChatName.value) return;
  await deleteChat(deleteChatId.value);
  deleteChatId.value = null;
}

// Detect whether the user is already viewing the newest chat messages.
function isAtChatBottom() {
  const element = chatScroll.value;
  return element ? element.scrollHeight - element.scrollTop - element.clientHeight <= 24 : true;
}

// Keep auto-scroll enabled only when the user is near the current bottom.
function handleChatScroll() {
  shouldFollowLatest.value = isAtChatBottom();
}

// Jump the chat view to the most recent message when the user is following the stream.
async function scrollToLatest() {
  await nextTick();
  if (chatScroll.value) {
    chatScroll.value.scrollTop = chatScroll.value.scrollHeight;
    shouldFollowLatest.value = true;
  }
}

watch(
  messageList,
  () => {
    if (shouldFollowLatest.value) void scrollToLatest();
  },
  { deep: true, flush: "post" },
);
watch(activeChatId, () => {
  shouldFollowLatest.value = true;
  void scrollToLatest();
});

void initializeAuth();
watchEffect(() => {
  if (authLoading.value) return;
  if (!user.value && route.path !== "/login" && route.path !== "/register") {
    void router.replace("/login");
  }
  if (user.value && (route.path === "/login" || route.path === "/register")) {
    void router.replace("/");
  }
});

// Submit a message on Enter while allowing Shift+Enter for multiline input.
function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submitMessage();
  }
}

// Send the current draft and clear selected files only after a successful request.
async function submitMessage() {
  const sent = await sendMessage(getAttachmentFileList());
  if (sent) attachments.value = [];
}

// Convert Markdown into sanitized HTML before it is rendered in the chat.
function renderMarkdown(content: string) {
  return DOMPurify.sanitize(marked.parse(content, { async: false }));
}
</script>
<template>
  <RouterView v-if="route.path !== '/'" />
  <main
    v-else-if="user"
    class="flex h-screen overflow-hidden bg-[var(--theme-background)] text-[var(--theme-text)]"
  >
    <aside
      v-if="sidebarVisible"
      class="hidden w-[278px] shrink-0 flex-col border-r border-[var(--theme-border)] bg-[var(--theme-sidebar)] px-[18px] py-7 md:flex"
    >
      <div class="flex items-center gap-3 px-2 pb-8">
        <div
          class="grid size-8 place-items-center rounded-lg bg-[var(--theme-accent)] font-mono text-lg font-medium text-[#f9f7f2]"
        >
          O
        </div>
        <div>
          <p class="text-[13px] font-extrabold">Ollama desk</p>
          <p
            class="mt-1 font-mono text-[10px] uppercase tracking-[0.09em] text-[var(--theme-muted)]"
          >
            Local intelligence
          </p>
        </div>
        <button
          class="ml-auto bg-transparent text-2xl leading-none text-[var(--theme-muted)]"
          aria-label="Collapse sidebar"
          @click="setSidebarVisible(false)"
        >
          ‹
        </button>
      </div>

      <button
        class="flex w-full items-center gap-2.5 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-input)] px-3.5 py-3 text-left text-xs font-bold text-[var(--theme-text)] shadow-sm transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
        @click="createNewChat"
      >
        <span class="text-lg leading-3 text-[var(--theme-accent)]">+</span> New conversation
      </button>

      <div class="mt-9">
        <div
          class="flex items-center justify-between px-2.5 pb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--theme-muted)]"
        >
          <span>Today</span>
          <span class="text-[var(--theme-subtle)]">{{ chats.length }}</span>
        </div>
        <div class="space-y-1">
          <button
            v-for="chat in chats"
            :key="chat.id"
            class="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-3 text-left text-[var(--theme-text)] transition hover:bg-[var(--theme-background)]"
            :class="chat.id === activeChatId ? 'bg-[var(--theme-background)] shadow-sm' : ''"
            @click="selectChat(chat.id)"
          >
            <span class="size-1.5 shrink-0 rounded-full bg-[var(--theme-accent)]"></span>
            <span class="flex min-w-0 flex-1 flex-col gap-1">
              <strong class="truncate text-[11px]">{{ chat.title }}</strong>
              <small class="font-mono text-[9px] text-[var(--theme-subtle)]">{{
                new Date(chat.createdAt).toLocaleDateString()
              }}</small>
            </span>
            <span
              role="button"
              tabindex="0"
              class="hidden px-1 text-xs text-[var(--theme-subtle)] hover:text-[var(--theme-accent)] group-hover:inline"
              aria-label="Delete chat"
              @click.stop="openDelete(chat)"
              @keydown.enter.stop="openDelete(chat)"
            >
              ×
            </span>
            <span
              role="button"
              tabindex="0"
              class="hidden px-1 text-xs text-[var(--theme-subtle)] hover:text-[var(--theme-accent)] group-hover:inline"
              aria-label="Rename chat"
              @click.stop="openRename(chat)"
              @keydown.enter.stop="openRename(chat)"
            >
              ✎
            </span>
          </button>
        </div>
      </div>

      <div class="mt-auto border-t border-[var(--theme-border)] px-2 pt-4">
        <div class="flex items-center gap-2 font-mono text-[10px] text-[var(--theme-muted)]">
          <span class="size-1.5 rounded-full bg-[var(--theme-accent)]"></span> Ollama connected
        </div>
        <div class="mt-4 flex gap-2 text-[10px] text-[var(--theme-subtle)]">
          <span class="max-w-[130px] truncate text-[var(--theme-muted)]">{{ user.username }}</span>
          <span>·</span>
          <button
            class="text-[var(--theme-muted)] hover:text-[var(--theme-accent)]"
            @click="router.push('/settings')"
          >
            Settings
          </button>
          <span>·</span>
          <button
            class="text-[var(--theme-muted)] hover:text-[var(--theme-accent)]"
            @click="logout"
          >
            Log out
          </button>
        </div>
      </div>
    </aside>

    <section class="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header
        class="flex items-center justify-between gap-5 border-b border-[var(--theme-border)] px-5 py-6 sm:px-[6.5%]"
      >
        <div>
          <div
            class="mb-2.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--theme-muted)]"
          >
            <span class="size-1.5 rounded-full bg-[var(--theme-accent)]"></span> Private workspace
          </div>
          <h1 class="text-xl font-bold tracking-tight sm:text-2xl">
            {{ activeChat?.title ?? "Conversation" }}
          </h1>
        </div>
        <div class="flex items-center gap-3">
          <button
            v-if="!sidebarVisible"
            class="rounded-md border border-[var(--theme-border)] px-2 py-1 text-xs text-[var(--theme-muted)] hover:border-[var(--theme-accent)]"
            @click="setSidebarVisible(true)"
          >
            Chats
          </button>
          <span
            class="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--theme-muted)] sm:flex"
            ><span class="size-1.5 rounded-full bg-[var(--theme-accent)]"></span> Ready</span
          >
          <button
            class="bg-transparent text-lg text-[var(--theme-muted)]"
            aria-label="More conversation options"
          >
            •••
          </button>
        </div>
      </header>

      <div class="flex min-h-0 flex-1 flex-col px-5 py-7 sm:px-[6.5%]">
        <div
          ref="chatScroll"
          class="min-h-0 flex-1 overflow-y-auto pr-1"
          @scroll="handleChatScroll"
        >
          <div
            v-if="messageList.length === 0"
            class="flex min-h-full flex-col items-center justify-center py-16 text-center"
          >
            <div
              class="mb-4 grid size-12 place-items-center rounded-xl bg-[var(--theme-accent)] font-mono text-2xl text-[#f9f7f2]"
            >
              ✦
            </div>
            <h2 class="text-xl font-bold">Start a fresh conversation</h2>
            <p class="mt-2 max-w-md text-sm leading-6 text-[var(--theme-muted)]">
              Bring a question, a half-formed idea, or a problem you want to untangle.
            </p>
          </div>
          <div v-else class="mx-auto w-full max-w-3xl space-y-7">
            <article v-for="message in messageList" :key="message.id" class="flex gap-3">
              <div
                class="grid size-8 shrink-0 place-items-center rounded-lg font-mono text-xs font-medium"
                :class="
                  message.role === 'assistant'
                    ? 'bg-[var(--theme-accent)] text-[#fffaf4]'
                    : 'bg-[var(--theme-sidebar)] text-[var(--theme-text)]'
                "
              >
                {{ message.role === "assistant" ? "O" : "Y" }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="mb-1.5 flex items-baseline gap-2 text-xs">
                  <strong>{{
                    message.role === "assistant" ? message.model || "Assistant" : "You"
                  }}</strong>
                  <span class="font-mono text-[10px] text-[var(--theme-subtle)]">{{
                    message.time
                  }}</span>
                </div>
                <details
                  v-if="message.thinking"
                  class="mb-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-sidebar)] px-3 py-2 text-xs text-[var(--theme-muted)]"
                  :open="isGenerating"
                >
                  <summary
                    class="cursor-pointer select-none font-semibold text-[var(--theme-text)]"
                  >
                    Thinking{{ isGenerating ? "..." : "" }}
                  </summary>
                  <div class="mt-2 whitespace-pre-wrap leading-6">{{ message.thinking }}</div>
                </details>

                <!-- Attached files rendering inside MessageList -->
                <div v-if="message.attachments?.length" class="mb-3 space-y-2">
                  <div
                    v-for="file in message.attachments"
                    :key="getFileKey(file)"
                    class="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-background)] p-2.5 text-xs"
                  >
                    <div
                      class="flex items-center justify-between font-mono text-[11px] text-[var(--theme-muted)]"
                    >
                      <span class="font-semibold">{{ file.name }}</span>
                      <div class="flex items-center gap-2">
                        <button
                          type="button"
                          class="text-[10px] uppercase text-[var(--theme-accent)] hover:underline"
                          @click="toggleExpand(file)"
                        >
                          {{ expandedAttachments[getFileKey(file)] ? "Show less" : "Show full" }}
                        </button>
                        <button
                          type="button"
                          class="text-[10px] uppercase text-[var(--theme-muted)] hover:underline"
                          @click="toggleHideAttachment(file)"
                        >
                          {{
                            hiddenAttachments[getFileKey(file)]
                              ? "Unhide attachment"
                              : "Hide attachment"
                          }}
                        </button>
                      </div>
                    </div>

                    <!-- Message List Preview Block -->
                    <div
                      v-if="!hiddenAttachments[getFileKey(file)]"
                      class="mt-1.5 cursor-pointer rounded bg-[var(--theme-sidebar)] p-2 font-mono text-[10px] text-[var(--theme-text)] leading-relaxed"
                      @click="toggleExpand(file)"
                    >
                      <pre
                        v-if="expandedAttachments[getFileKey(file)]"
                        class="max-h-96 overflow-y-auto whitespace-pre-wrap break-all"
                        >{{ getDisplayContent(file) || "Loading content..." }}</pre
                      >
                      <pre
                        v-else
                        class="max-h-24 overflow-hidden whitespace-pre-wrap break-all opacity-80"
                        >{{ getPreviewText(file) }}</pre
                      >
                    </div>
                  </div>
                </div>

                <div
                  class="min-h-14 w-full resize-none border-0 bg-transparent px-2 py-1 text-sm leading-6 text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-subtle)]"
                  v-html="renderMarkdown(message.content)"
                ></div>
              </div>
            </article>
            <div v-if="isGenerating" class="flex items-center gap-3">
              <span
                class="grid size-8 place-items-center rounded-lg bg-[var(--theme-accent)] font-mono text-xs text-[#fffaf4]"
                >O</span
              >
              <span
                class="flex items-center gap-2 rounded-full bg-[var(--theme-sidebar)] px-3 py-2 text-xs text-[var(--theme-muted)]"
                ><i class="size-1.5 animate-pulse rounded-full bg-[var(--theme-accent)]"></i
                ><i
                  class="size-1.5 animate-pulse rounded-full bg-[var(--theme-accent)] [animation-delay:150ms]"
                ></i
                ><i
                  class="size-1.5 animate-pulse rounded-full bg-[var(--theme-accent)] [animation-delay:300ms]"
                ></i
                ><span>{{ thinking ? "Thinking..." : "Generating..." }}</span></span
              >
            </div>
          </div>
        </div>

        <div class="mx-auto mt-8 w-full max-w-3xl">
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <span class="mr-1 font-mono text-[10px] uppercase tracking-wider text-[#9a948b]"
              >Try asking</span
            >
            <button
              class="rounded-full border border-[var(--theme-border)] px-3 py-1.5 text-[11px] text-[var(--theme-muted)] transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
              @click="selectPrompt('Summarize a complex idea for me')"
            >
              Summarize an idea
            </button>
            <button
              class="rounded-full border border-[var(--theme-border)] px-3 py-1.5 text-[11px] text-[var(--theme-muted)] transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
              @click="selectPrompt('Help me plan my next project')"
            >
              Plan a project
            </button>
            <button
              class="rounded-full border border-[var(--theme-border)] px-3 py-1.5 text-[11px] text-[var(--theme-muted)] transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
              @click="selectPrompt('Review this code for me')"
            >
              Review some code
            </button>
          </div>
          <form
            class="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-input)] p-3 shadow-[0_8px_30px_rgba(122,108,91,0.08)]"
            @submit.prevent="submitMessage"
          >
            <textarea
              v-model="draft"
              rows="1"
              placeholder="Message your local assistant..."
              class="min-h-14 w-full resize-none border-0 bg-transparent px-2 py-1 text-sm leading-6 text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-subtle)]"
              aria-label="Message your local assistant"
              @keydown="handleComposerKeydown"
            ></textarea>
            <div
              class="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--theme-border)] pt-3"
            >
              <div class="flex items-center gap-4">
                <button
                  type="button"
                  class="text-xs text-[var(--theme-muted)]"
                  aria-label="Attach a file"
                  @click="composerActions.attach"
                >
                  ＋ Attach
                </button>
                <input
                  ref="attachmentInput"
                  class="hidden"
                  type="file"
                  multiple
                  accept=".txt,.md,.json,.csv,.ts,.js,.vue,.py,.html,.css"
                  aria-label="Choose files to attach"
                  @change="handleFileSelection"
                />
                <label
                  class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--theme-muted)]"
                  for="composer-model"
                >
                  Model
                  <select
                    id="composer-model"
                    v-model="ollamaStore.selectedModel"
                    class="max-w-[150px] rounded-md border border-[var(--theme-border)] bg-[var(--theme-background)] px-2 py-1.5 font-sans text-xs normal-case tracking-normal text-[var(--theme-text)] outline-none focus:border-[var(--theme-accent)]"
                  >
                    <option v-if="ollamaStore.models.length === 0" value="" disabled>
                      Waiting for models...
                    </option>
                    <option v-for="model in ollamaStore.models" :key="model" :value="model">
                      {{ model }}
                    </option>
                  </select>
                </label>
                <label class="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
                  <input v-model="tsundere" type="checkbox" class="accent-[var(--theme-accent)]" />
                  Tsundere
                </label>
                <label class="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
                  <input v-model="thinking" type="checkbox" class="accent-[var(--theme-accent)]" />
                  Thinking
                </label>
                <label class="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
                  <input v-model="streaming" type="checkbox" class="accent-[var(--theme-accent)]" />
                  Stream
                </label>
              </div>
              <button
                class="grid size-9 place-items-center rounded-lg bg-[var(--theme-accent)] text-lg text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                type="submit"
                :disabled="(!draft.trim() && !attachments.length) || isGenerating"
                aria-label="Send message"
              >
                ↑
              </button>
            </div>
            <div v-if="attachments.length" class="mt-3 space-y-2 px-2">
              <div
                v-for="(file, index) in attachments"
                :key="getFileKey(file)"
                class="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-background)] p-2.5 text-xs"
              >
                <!-- Header with File Name, Hide Toggle, Expand Toggle, and Delete -->
                <div
                  class="flex items-center justify-between font-mono text-[11px] text-[var(--theme-muted)]"
                >
                  <span class="font-semibold">{{ file.name }}</span>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="text-[10px] uppercase text-[var(--theme-accent)] hover:underline"
                      @click="toggleExpand(file)"
                    >
                      {{ expandedAttachments[getFileKey(file)] ? "Show less" : "Show full" }}
                    </button>
                    <button
                      type="button"
                      class="text-[10px] uppercase text-[var(--theme-muted)] hover:underline"
                      @click="toggleHideAttachment(file)"
                    >
                      {{
                        hiddenAttachments[getFileKey(file)]
                          ? "Unhide attachment"
                          : "Hide attachment"
                      }}
                    </button>
                    <button
                      type="button"
                      class="text-[var(--theme-subtle)] hover:text-[var(--theme-accent)]"
                      :aria-label="`Remove ${file.name}`"
                      @click="removeAttachment(index)"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <!-- Interactive Code / Text Preview Block -->
                <div
                  v-if="!hiddenAttachments[getFileKey(file)]"
                  class="mt-1.5 cursor-pointer rounded bg-[var(--theme-sidebar)] p-2 font-mono text-[10px] text-[var(--theme-text)] leading-relaxed"
                  @click="toggleExpand(file)"
                >
                  <pre
                    v-if="expandedAttachments[getFileKey(file)]"
                    class="whitespace-pre-wrap break-all"
                    >{{ attachmentContents[getFileKey(file)] || getDisplayContent(file) }}</pre
                  >
                  <pre v-else class="line-clamp-5 whitespace-pre-wrap break-all opacity-80">{{
                    getPreviewText(file)
                  }}</pre>
                </div>
              </div>
            </div>
          </form>
          <p class="mt-3 text-center font-mono text-[10px] text-[var(--theme-subtle)]">
            Ollama can make mistakes. Check important information.
          </p>
        </div>
      </div>
    </section>

    <div
      v-if="renameChatId"
      class="fixed inset-0 z-10 grid place-items-center bg-[var(--theme-text)]/30 px-5"
    >
      <form
        class="w-full max-w-md rounded-xl bg-[var(--theme-surface)] p-6 shadow-xl"
        @submit.prevent="submitRename"
      >
        <h2 class="text-lg font-bold">Rename chat</h2>
        <label class="mt-4 block text-sm font-semibold">
          Chat name
          <input
            v-model="renameValue"
            type="text"
            required
            class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
          />
        </label>
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="px-3 py-2 text-sm text-[var(--theme-muted)]"
            @click="renameChatId = null"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-bold text-white"
          >
            Save
          </button>
        </div>
      </form>
    </div>

    <div
      v-if="deleteChatId"
      class="fixed inset-0 z-10 grid place-items-center bg-[var(--theme-text)]/30 px-5"
    >
      <form
        class="w-full max-w-md rounded-xl bg-[var(--theme-surface)] p-6 shadow-xl"
        @submit.prevent="confirmDelete"
      >
        <h2 class="text-lg font-bold">Delete chat?</h2>
        <p class="mt-2 text-sm leading-6 text-[var(--theme-muted)]">
          Type <strong class="text-[#4d4841]">{{ deleteChatName }}</strong> to permanently delete
          this conversation.
        </p>
        <input
          v-model="deleteConfirmation"
          type="text"
          autocomplete="off"
          class="mt-4 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
        />
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="px-3 py-2 text-sm text-[var(--theme-muted)]"
            @click="deleteChatId = null"
          >
            Cancel
          </button>
          <button
            type="submit"
            :disabled="deleteConfirmation !== deleteChatName"
            class="rounded-lg bg-[#a9432c] px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete permanently
          </button>
        </div>
      </form>
    </div>
  </main>
</template>
