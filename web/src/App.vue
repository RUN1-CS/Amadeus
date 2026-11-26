<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

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
  if (
    !user.value &&
    route.path !== "/login" &&
    route.path !== "/register" &&
    (route.meta.errorPage !== true || route.path === "/")
  ) {
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
        {{ $t("app.dropFiles") }}
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
            <span class="size-1.5 rounded-full bg-[var(--theme-accent)]"></span>
            {{ $t("app.privateWorkspace") }}
          </div>
          <h1 class="text-xl font-bold tracking-tight sm:text-2xl">
            {{ activeChat?.title ?? $t("app.conversation") }}
          </h1>
        </div>
        <div class="flex items-center gap-3">
          <button
            v-if="!sidebarVisible"
            class="rounded-md border border-[var(--theme-border)] px-2 py-1 text-xs text-[var(--theme-muted)] hover:border-[var(--theme-accent)]"
            @click="setSidebarVisible(true)"
          >
            {{ $t("app.chats") }}
          </button>
          <span
            class="hidden items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[var(--theme-muted)] sm:flex"
            ><span class="size-1.5 rounded-full bg-[var(--theme-accent)]"></span>
            {{ $t("app.ready") }}</span
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
            <span class="mr-1 font-mono text-[10px] uppercase tracking-wider text-[#9a948b]">{{
              $t("app.tryAsking")
            }}</span>
            <button
              class="rounded-full border border-[var(--theme-border)] px-3 py-1.5 text-[11px] text-[var(--theme-muted)] transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
              @click="selectPrompt($t('app.summarizePrompt'))"
            >
              {{ $t("app.summarizeIdea") }}
            </button>
            <button
              class="rounded-full border border-[var(--theme-border)] px-3 py-1.5 text-[11px] text-[var(--theme-muted)] transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
              @click="selectPrompt($t('app.planPrompt'))"
            >
              {{ $t("app.planProject") }}
            </button>
            <button
              class="rounded-full border border-[var(--theme-border)] px-3 py-1.5 text-[11px] text-[var(--theme-muted)] transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
              @click="selectPrompt($t('app.reviewPrompt'))"
            >
              {{ $t("app.reviewCode") }}
            </button>
          </div>
          <form
            class="overflow-hidden rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-input)] shadow-[0_8px_30px_rgba(122,108,91,0.08)] transition focus-within:border-[var(--theme-accent)]/60"
            @submit.prevent="submitMessage"
          >
            <!-- Attachments -->
            <div
              v-if="attachments.length"
              class="space-y-2 border-b border-[var(--theme-border)] p-3"
            >
              <div
                v-for="(file, index) in attachments"
                :key="getFileKey(file)"
                class="overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-background)]"
              >
                <div class="flex items-center justify-between gap-2 px-3 py-2">
                  <span
                    class="min-w-0 truncate font-mono text-[11px] font-semibold text-[var(--theme-text)]"
                  >
                    {{ file.name }}
                  </span>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--theme-accent)] transition hover:bg-[var(--theme-sidebar)]"
                      @click="toggleExpand(file)"
                    >
                      {{
                        expandedAttachments[getFileKey(file)]
                          ? $t("app.showLess")
                          : $t("app.showFull")
                      }}
                    </button>
                    <button
                      type="button"
                      class="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase text-[var(--theme-muted)] transition hover:bg-[var(--theme-sidebar)] hover:text-[var(--theme-text)]"
                      @click="toggleHideAttachment(file)"
                    >
                      {{
                        hiddenAttachments[getFileKey(file)]
                          ? $t("app.unhideAttachment")
                          : $t("app.hideAttachment")
                      }}
                    </button>
                    <button
                      type="button"
                      class="grid size-6 place-items-center rounded text-base leading-none text-[var(--theme-subtle)] transition hover:bg-[var(--theme-sidebar)] hover:text-[var(--theme-accent)]"
                      :aria-label="$t('app.removeAttachment', { filename: file.name })"
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
                  class="h-80 w-full border-t border-[var(--theme-border)] bg-[var(--theme-sidebar)]"
                ></iframe>
                <div
                  v-else-if="!isPdfFile(file) && !hiddenAttachments[getFileKey(file)]"
                  class="cursor-pointer border-t border-[var(--theme-border)] bg-[var(--theme-sidebar)] p-3 font-mono text-[10px] leading-relaxed text-[var(--theme-text)]"
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

            <!-- Input row -->
            <div class="flex items-end gap-2 p-3">
              <button
                type="button"
                class="grid size-9 shrink-0 place-items-center rounded-lg text-lg text-[var(--theme-muted)] transition hover:bg-[var(--theme-background)] hover:text-[var(--theme-text)]"
                :aria-label="$t('app.attachFile')"
                :title="$t('app.attachFile')"
                @click="composerActions.attach"
              >
                <span aria-hidden="true">＋</span>
              </button>

              <textarea
                v-model="draft"
                rows="1"
                :placeholder="$t('app.messagePlaceholder')"
                class="max-h-48 min-h-9 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-sm leading-6 text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-subtle)]"
                :aria-label="$t('app.messageAriaLabel')"
                @keydown="handleComposerKeydown"
              ></textarea>

              <input
                ref="attachmentInput"
                class="hidden"
                type="file"
                multiple
                accept="image/*,application/pdf,.pdf,.txt,.md,.json,.csv,.ts,.js,.vue,.py,.html,.css"
                :aria-label="$t('app.chooseFiles')"
                @change="handleFileSelection"
              />

              <button
                class="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--theme-accent)] text-lg text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                type="submit"
                :disabled="(!draft.trim() && !attachments.length) || isGenerating"
                :aria-label="$t('app.sendMessage')"
              >
                <span
                  v-if="isGenerating"
                  class="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden="true"
                ></span>
                <span v-else>↑</span>
              </button>
            </div>

            <!-- Toolbar -->
            <div
              class="flex flex-col gap-2 border-t border-[var(--theme-border)] bg-[var(--theme-background)]/40 px-3 py-2 lg:flex-row lg:items-center lg:justify-between"
            >
              <!-- Model pickers -->
              <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <div class="flex min-w-0 items-center gap-1.5">
                  <label
                    for="composer-model"
                    class="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--theme-muted)]"
                  >
                    {{ $t("app.model") }}
                  </label>
                  <select
                    id="composer-model"
                    v-model="ollamaStore.selectedModel"
                    class="min-w-0 max-w-full rounded-full border border-[var(--theme-border)] bg-[var(--theme-input)] px-3 py-1 text-xs text-[var(--theme-text)] outline-none transition focus:border-[var(--theme-accent)] sm:max-w-48"
                  >
                    <option v-if="ollamaStore.models.length === 0" value="" disabled>
                      {{ $t("app.waitingForModels") }}
                    </option>
                    <option v-for="model in ollamaStore.models" :key="model" :value="model">
                      {{ model }}
                    </option>
                  </select>
                </div>

                <div class="flex min-w-0 items-center gap-1.5">
                  <label
                    for="comfy-model"
                    class="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[var(--theme-muted)]"
                  >
                    {{ $t("app.imageModel") }}
                  </label>
                  <select
                    id="comfy-model"
                    v-model="selectedComfyModel"
                    class="min-w-0 max-w-full rounded-full border border-[var(--theme-border)] bg-[var(--theme-input)] px-3 py-1 text-xs text-[var(--theme-text)] outline-none transition focus:border-[var(--theme-accent)] sm:max-w-48"
                  >
                    <option v-if="comfyModels.length === 0" value="" disabled>
                      {{ $t("app.noCheckpoints") }}
                    </option>
                    <option v-for="model in comfyModels" :key="model" :value="model">
                      {{ model }}
                    </option>
                  </select>
                </div>
              </div>

              <!-- Option chips -->
              <div class="flex flex-wrap items-center gap-1.5">
                <label
                  v-for="opt in [
                    { key: 'tsundere', label: $t('app.tsundere') },
                    { key: 'thinking', label: $t('app.thinking') },
                    { key: 'streaming', label: $t('app.stream') },
                  ]"
                  :key="opt.key"
                  class="cursor-pointer select-none"
                >
                  <input v-model="selectedOptions[opt.key]" type="checkbox" class="peer sr-only" />
                  <span
                    class="inline-flex items-center rounded-full border border-[var(--theme-border)] bg-[var(--theme-input)] px-3 py-1 text-xs text-[var(--theme-muted)] transition-colors hover:text-[var(--theme-text)] peer-checked:border-[var(--theme-accent)] peer-checked:bg-[var(--theme-accent)]/10 peer-checked:text-[var(--theme-accent)] peer-focus-visible:ring-1 peer-focus-visible:ring-[var(--theme-accent)]"
                  >
                    {{ opt.label }}
                  </span>
                </label>
              </div>
            </div>
          </form>
          <p class="mt-3 text-center font-mono text-[10px] text-[var(--theme-subtle)]">
            {{ $t("app.disclaimer") }}
          </p>
        </div>
      </div>
    </section>
  </main>
</template>
