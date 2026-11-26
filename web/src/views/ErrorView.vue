<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

<script setup lang="ts">
import { useRouter } from "vue-router";

const props = defineProps<{
  code: 403 | 404 | 500 | 503;
}>();

const router = useRouter();

function goHome() {
  void router.push("/");
}

function retry() {
  router.go(0);
}
</script>

<template>
  <main
    class="flex min-h-screen items-center justify-center bg-[var(--theme-background)] px-5 py-12 text-[var(--theme-text)]"
  >
    <section
      class="w-full max-w-xl rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-8 text-center shadow-2xl sm:p-12"
      aria-labelledby="error-title"
    >
      <img class="mx-auto mb-8 size-12" src="/amadeus_icon.svg" alt="" />
      <p class="font-mono text-7xl font-bold tracking-tight text-[var(--theme-accent)] sm:text-8xl">
        {{ props.code }}
      </p>
      <h1 id="error-title" class="mt-5 text-2xl font-bold sm:text-3xl">
        {{ $t(`errors.${props.code}.title`) }}
      </h1>
      <p class="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--theme-muted)] sm:text-base">
        {{ $t(`errors.${props.code}.description`) }}
      </p>

      <div class="mt-8 flex flex-wrap justify-center gap-3">
        <button
          class="rounded-lg bg-[var(--theme-accent)] px-5 py-2.5 text-sm font-bold text-[var(--theme-background)] transition hover:opacity-80"
          @click="goHome"
        >
          {{ $t("common.backHome") }}
        </button>
        <button
          v-if="props.code === 500 || props.code === 503"
          class="rounded-lg border border-[var(--theme-border)] px-5 py-2.5 text-sm font-semibold text-[var(--theme-text)] transition hover:border-[var(--theme-accent)] hover:text-[var(--theme-accent)]"
          @click="retry"
        >
          {{ $t("common.retry") }}
        </button>
      </div>
    </section>
  </main>
</template>
