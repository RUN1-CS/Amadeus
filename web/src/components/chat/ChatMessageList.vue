<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";

import type { AttachmentItem, ChatMessage } from "@/types/chat";
import { getFileKey } from "@/composables/useChatAttachments";

defineProps<{
  messages: ChatMessage[];
  isGenerating: boolean;
  thinking: boolean;
  expandedAttachments: Record<string, boolean>;
  hiddenAttachments: Record<string, boolean>;
  loadedAttachmentUrls: Record<string, string>;
  toggleExpand: (file: AttachmentItem) => void;
  toggleHideAttachment: (file: AttachmentItem) => void;
  getDisplayContent: (file: AttachmentItem) => string;
  getPreviewText: (file: AttachmentItem) => string;
}>();

function renderMarkdown(content: string | null | undefined) {
  return DOMPurify.sanitize(marked.parse(content ?? "", { async: false }));
}
</script>

<template>
  <div
    v-if="messages.length === 0"
    class="flex min-h-full flex-col items-center justify-center py-16 text-center"
  >
    <div
      class="mb-4 grid size-12 place-items-center rounded-xl bg-[var(--theme-accent)] font-mono text-2xl text-[#f9f7f2]"
    >
      ✦
    </div>
    <h2 class="text-xl font-bold">{{ $t("chat.freshConversation") }}</h2>
    <p class="mt-2 max-w-md text-sm leading-6 text-[var(--theme-muted)]">
      {{ $t("chat.freshConversationDescription") }}
    </p>
  </div>
  <div v-else class="mx-auto w-full max-w-3xl space-y-7">
    <article v-for="message in messages" :key="message.id" class="flex gap-3">
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
          <strong>
            {{
              message.role === "assistant" ? message.model || $t("chat.assistant") : $t("chat.you")
            }}
          </strong>
          <span class="font-mono text-[10px] text-[var(--theme-subtle)]">{{ message.time }}</span>
        </div>
        <details
          v-if="message.thinking"
          class="mb-3 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-sidebar)] px-3 py-2 text-xs text-[var(--theme-muted)]"
          :open="isGenerating"
        >
          <summary class="cursor-pointer select-none font-semibold text-[var(--theme-text)]">
            Thinking{{ isGenerating ? "..." : "" }}
          </summary>
          <div class="mt-2 whitespace-pre-wrap leading-6">{{ message.thinking }}</div>
        </details>

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
                  {{
                    expandedAttachments[getFileKey(file)] ? $t("app.showLess") : $t("app.showFull")
                  }}
                </button>
                <button
                  type="button"
                  class="text-[10px] uppercase text-[var(--theme-muted)] hover:underline"
                  @click="toggleHideAttachment(file)"
                >
                  {{
                    hiddenAttachments[getFileKey(file)]
                      ? $t("app.unhideAttachment")
                      : $t("app.hideAttachment")
                  }}
                </button>
              </div>
            </div>

            <img
              v-if="file.kind === 'image' && !hiddenAttachments[getFileKey(file)]"
              :src="loadedAttachmentUrls[getFileKey(file)]"
              :alt="file.name"
              class="mt-1.5 max-h-[32rem] w-full rounded bg-[var(--theme-sidebar)] object-contain"
            />
            <iframe
              v-else-if="
                file.kind === 'pdf' &&
                !hiddenAttachments[getFileKey(file)] &&
                (loadedAttachmentUrls[getFileKey(file)] || file.url)
              "
              :src="loadedAttachmentUrls[getFileKey(file)] || file.url"
              :title="file.name"
              class="mt-1.5 h-[32rem] w-full rounded bg-[var(--theme-sidebar)]"
            ></iframe>
            <div
              v-else-if="!hiddenAttachments[getFileKey(file)]"
              class="mt-1.5 cursor-pointer rounded bg-[var(--theme-sidebar)] p-2 font-mono text-[10px] leading-relaxed text-[var(--theme-text)]"
              @click="toggleExpand(file)"
            >
              <pre
                v-if="expandedAttachments[getFileKey(file)]"
                class="max-h-96 overflow-y-auto whitespace-pre-wrap break-all"
                >{{ getDisplayContent(file) || $t("chat.loadingContent") }}</pre
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
    <div v-if="isGenerating" class="flex items-center gap-3" aria-live="polite">
      <span
        class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--theme-accent)] font-mono text-xs text-[#fffaf4]"
      >
        O
      </span>
      <div
        class="flex items-center gap-3 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-sidebar)] px-3.5 py-2.5"
      >
        <span class="relative size-4 shrink-0" aria-hidden="true">
          <span
            class="absolute inset-0 rounded-full border-2 border-[var(--theme-accent)]/25"
          ></span>
          <span
            class="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[var(--theme-accent)]"
          ></span>
        </span>
        <div class="flex flex-col">
          <span class="text-xs font-semibold text-[var(--theme-text)]">
            {{ thinking ? $t("app.thinking") : $t("chat.generatingResponse") }}
          </span>
          <span
            class="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-[var(--theme-subtle)]"
          >
            {{ thinking ? $t("chat.reasoningLocally") : $t("chat.writingLocally") }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
