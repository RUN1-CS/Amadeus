<!-- Main chat shell: sidebar, composer, message rendering, and route-aware auth checks. -->
<script setup lang="ts">
import { computed, nextTick, ref, watch, watchEffect } from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import ChatMessageList from "./components/chat/ChatMessageList.vue";
import ChatSidebar from "./components/chat/ChatSidebar.vue";
import { getFileKey, isPdfFile, useChatAttachments } from "./composables/useChatAttachments";
import { useOllamaStore } from "./stores/ollama";
import type { Chat } from "./types/chat";
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
  selectedOptions,
  selectedComfyModel,
  comfyModels,
  chats,
  activeChatId,
  sidebarVisible,
} = storeToRefs(ollamaStore);
const { selectPrompt, sendMessage, initializeAuth, setSidebarVisible } = ollamaStore;

const activeChat = computed(() => chats.value.find((chat: Chat) => chat.id === activeChatId.value));
const chatScroll = ref<HTMLElement | null>(null);
const shouldFollowLatest = ref(true);
const attachmentTools = useChatAttachments(messageList);
const {
  attachmentInput,
  attachments,
  isDraggingFiles,
  attachmentContents,
  loadedAttachmentUrls,
  expandedAttachments,
  hiddenAttachments,
  getAttachmentFileList,
  getDisplayContent,
  getPreviewText,
  handleFileSelection,
  handleFileDragEnter,
  handleFileDragOver,
  handleFileDragLeave,
  handleFileDrop,
  removeAttachment,
  toggleExpand,
  toggleHideAttachment,
} = attachmentTools;

// Composer actions are kept in one place so future tools can be added without
// coupling their controls to the message composer markup.
const composerActions = {
  attach: () => attachmentInput.value?.click(),
};

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
  if (sent) {
    attachments.value = [];
  }
}
</script>
<template>
  <RouterView v-if="route.path !== '/'" />
  <main
    v-else-if="user"
    class="relative flex h-screen overflow-hidden bg-[var(--theme-background)] text-[var(--theme-text)]"
    @dragenter="handleFileDragEnter"
    @dragover="handleFileDragOver"
    @dragleave="handleFileDragLeave"
    @drop="handleFileDrop"
  >
    <div
      v-if="isDraggingFiles"
      class="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-2xl border-2 border-dashed border-[var(--theme-accent)] bg-[var(--theme-accent)]/10"
    >
      <span
        class="rounded-xl bg-[var(--theme-surface)] px-6 py-4 text-sm font-semibold text-[var(--theme-text)] shadow-lg"
      >
        Drop files to attach
      </span>
    </div>
    <ChatSidebar />

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
        </div>
      </header>

      <div class="flex min-h-0 flex-1 flex-col px-5 py-7 sm:px-[6.5%]">
        <div
          ref="chatScroll"
          class="min-h-0 flex-1 overflow-y-auto pr-1"
          @scroll="handleChatScroll"
        >
          <ChatMessageList
            :messages="messageList"
            :is-generating="isGenerating"
            :thinking="selectedOptions.thinking"
            :expanded-attachments="expandedAttachments"
            :hidden-attachments="hiddenAttachments"
            :loaded-attachment-urls="loadedAttachmentUrls"
            :toggle-expand="toggleExpand"
            :toggle-hide-attachment="toggleHideAttachment"
            :get-display-content="getDisplayContent"
            :get-preview-text="getPreviewText"
          />
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
            <div v-if="attachments.length" class="mb-3 space-y-2 px-2">
              <div
                v-for="(file, index) in attachments"
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

                <iframe
                  v-if="isPdfFile(file) && !hiddenAttachments[getFileKey(file)]"
                  :src="loadedAttachmentUrls[getFileKey(file)]"
                  :title="file.name"
                  class="mt-1.5 h-80 w-full rounded bg-[var(--theme-sidebar)]"
                ></iframe>
                <div
                  v-else-if="!isPdfFile(file) && !hiddenAttachments[getFileKey(file)]"
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
            <div class="border-t border-[var(--theme-border)] pt-3">
              <div class="flex items-center justify-between gap-3">
                <button
                  type="button"
                  class="rounded-md px-2 py-1.5 text-xs text-[var(--theme-muted)] transition hover:bg-[var(--theme-background)] hover:text-[var(--theme-text)]"
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
                  accept="image/*,application/pdf,.pdf,.txt,.md,.json,.csv,.ts,.js,.vue,.py,.html,.css"
                  aria-label="Choose files to attach"
                  @change="handleFileSelection"
                />
                <button
                  class="grid size-9 place-items-center rounded-lg bg-[var(--theme-accent)] text-lg text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                  type="submit"
                  :disabled="(!draft.trim() && !attachments.length) || isGenerating"
                  aria-label="Send message"
                >
                  <span
                    v-if="isGenerating"
                    class="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    aria-hidden="true"
                  ></span>
                  <span v-else>↑</span>
                </button>
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-2 sm:gap-3">
                <label
                  class="flex min-w-[150px] flex-1 items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--theme-muted)]"
                  for="composer-model"
                >
                  Model
                  <select
                    id="composer-model"
                    v-model="ollamaStore.selectedModel"
                    class="min-w-0 flex-1 rounded-md border border-[var(--theme-border)] bg-[var(--theme-background)] px-2 py-1.5 font-sans text-xs normal-case tracking-normal text-[var(--theme-text)] outline-none focus:border-[var(--theme-accent)]"
                  >
                    <option v-if="ollamaStore.models.length === 0" value="" disabled>
                      Waiting for models...
                    </option>
                    <option v-for="model in ollamaStore.models" :key="model" :value="model">
                      {{ model }}
                    </option>
                  </select>
                </label>
                <label
                  class="flex min-w-[170px] flex-1 items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--theme-muted)]"
                  for="comfy-model"
                >
                  Image model
                  <select
                    id="comfy-model"
                    v-model="selectedComfyModel"
                    class="min-w-0 flex-1 rounded-md border border-[var(--theme-border)] bg-[var(--theme-background)] px-2 py-1.5 font-sans text-xs normal-case tracking-normal text-[var(--theme-text)] outline-none focus:border-[var(--theme-accent)]"
                  >
                    <option v-if="comfyModels.length === 0" value="" disabled>
                      No checkpoints found
                    </option>
                    <option v-for="model in comfyModels" :key="model" :value="model">
                      {{ model }}
                    </option>
                  </select>
                </label>
                <label class="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
                  <input
                    v-model="selectedOptions.tsundere"
                    type="checkbox"
                    class="accent-[var(--theme-accent)]"
                  />
                  Tsundere
                </label>
                <label class="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
                  <input
                    v-model="selectedOptions.thinking"
                    type="checkbox"
                    class="accent-[var(--theme-accent)]"
                  />
                  Thinking
                </label>
                <label class="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
                  <input
                    v-model="selectedOptions.streaming"
                    type="checkbox"
                    class="accent-[var(--theme-accent)]"
                  />
                  Stream
                </label>
              </div>
            </div>
          </form>
          <p class="mt-3 text-center font-mono text-[10px] text-[var(--theme-subtle)]">
            Ollama can make mistakes. Check important information.
          </p>
        </div>
      </div>
    </section>
  </main>
</template>
