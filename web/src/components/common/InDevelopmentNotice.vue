<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

<script setup lang="ts">
import { ref } from "vue";

const dismissedStorageKey = "amadeus_in_development_notice_dismissed";
const isOpen = ref(
  import.meta.env.VITE_DEVELOPMENT_NOTICE !== "false" &&
    localStorage.getItem(dismissedStorageKey) !== "true",
);
const doNotShowAgain = ref(false);

function dismissNotice() {
  if (doNotShowAgain.value) {
    localStorage.setItem(dismissedStorageKey, "true");
  }
  isOpen.value = false;
}
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 px-4 py-8 backdrop-blur-sm"
  >
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="development-notice-title"
      aria-describedby="development-notice-description"
      class="w-full max-w-lg rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6 text-[var(--theme-text)] shadow-2xl sm:p-8"
    >
      <div
        class="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-300"
      >
        <span class="size-1.5 rounded-full bg-amber-300" aria-hidden="true"></span>
        {{ $t("app.developmentNoticeBadge") }}
      </div>
      <h2 id="development-notice-title" class="text-2xl font-bold tracking-tight">
        {{ $t("app.developmentNoticeTitle") }}
      </h2>
      <p
        id="development-notice-description"
        class="mt-3 text-sm leading-6 text-[var(--theme-muted)]"
      >
        {{ $t("app.developmentNoticeDescription") }}
      </p>
      <p class="mt-3 text-sm leading-6 text-[var(--theme-muted)]">
        {{ $t("app.developmentNoticeIssuesBefore") }}
        <a
          href="https://github.com/RUN1-CS/Amadeus/issues"
          target="_blank"
          rel="noopener noreferrer"
          class="font-semibold text-[var(--theme-accent)] underline underline-offset-4 hover:opacity-80"
        >
          {{ $t("app.developmentNoticeIssuesLink") }}
        </a>
        {{ $t("app.developmentNoticeIssuesAfter") }}
      </p>
      <label class="mt-6 flex cursor-pointer items-start gap-3 text-sm text-[var(--theme-muted)]">
        <input
          v-model="doNotShowAgain"
          type="checkbox"
          class="mt-0.5 size-4 accent-[var(--theme-accent)]"
        />
        <span>{{ $t("app.developmentNoticeDisable") }}</span>
      </label>
      <button
        type="button"
        autofocus
        class="mt-6 w-full rounded-lg bg-[var(--theme-accent)] px-4 py-3 text-sm font-bold text-slate-950 transition hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--theme-accent)]"
        @click="dismissNotice"
      >
        {{ $t("app.developmentNoticeContinue") }}
      </button>
    </section>
  </div>
</template>
