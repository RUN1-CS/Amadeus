<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { createApiClient } from "@/services/api";
import { useOllamaStore } from "@/stores/ollama";

type ServerLog = {
  id: string;
  loggedAt: string;
  level: string;
  event: string;
  metadata: Record<string, string | number | boolean>;
};

type LogPage = {
  logs: ServerLog[];
  nextCursor: string | null;
};

const store = useOllamaStore();
const { t } = useI18n();
const { token } = storeToRefs(store);
const api = createApiClient(() => token.value);
const logs = ref<ServerLog[]>([]);
const level = ref("");
const appliedLevel = ref("");
const eventFilter = ref("");
const appliedEventFilter = ref("");
const cursor = ref<string | null>(null);
const loading = ref(false);
const error = ref("");

async function loadLogs(reset = true) {
  if (loading.value) return;

  loading.value = true;
  error.value = "";
  const params = new URLSearchParams();
  if (appliedLevel.value) params.set("level", appliedLevel.value);
  if (appliedEventFilter.value) params.set("event", appliedEventFilter.value);
  if (!reset && cursor.value) params.set("beforeId", cursor.value);

  try {
    const query = params.size ? `?${params.toString()}` : "";
    const page = await api.request<LogPage>(`/api/admin/logs${query}`);
    logs.value = reset ? page.logs : [...logs.value, ...page.logs];
    cursor.value = page.nextCursor;
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : t("admin.logs.couldNotLoad");
  } finally {
    loading.value = false;
  }
}

function applyFilters() {
  appliedLevel.value = level.value;
  appliedEventFilter.value = eventFilter.value.trim();
  void loadLogs();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

function levelClass(value: string) {
  if (value === "error" || value === "fatal") {
    return "bg-[#f9e4dc] text-[#853c2a]";
  }
  if (value === "warn") return "bg-[#fff1d2] text-[#805c14]";
  return "bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]";
}

onMounted(() => void loadLogs());
</script>

<template>
  <section
    class="mt-6 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
  >
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-lg font-bold">{{ $t("admin.logs.recent") }}</h2>
        <p class="mt-1 text-sm text-[var(--theme-muted)]">
          {{ $t("admin.logs.retention") }}
        </p>
      </div>
      <button
        class="rounded-lg border border-[var(--theme-border)] px-3 py-2 text-sm font-semibold transition hover:border-[var(--theme-accent)] disabled:opacity-50"
        :disabled="loading"
        @click="loadLogs()"
      >
        {{ loading ? $t("admin.logs.loading") : $t("admin.logs.refresh") }}
      </button>
    </div>

    <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="applyFilters">
      <label class="grid gap-1 text-xs font-semibold text-[var(--theme-muted)]">
        {{ $t("admin.logs.level") }}
        <select
          v-model="level"
          class="min-w-32 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-background)] px-3 py-2 text-sm text-[var(--theme-text)]"
        >
          <option value="">{{ $t("admin.logs.allLevels") }}</option>
          <option value="trace">{{ $t("admin.logs.trace") }}</option>
          <option value="debug">{{ $t("admin.logs.debug") }}</option>
          <option value="info">{{ $t("admin.logs.info") }}</option>
          <option value="warn">{{ $t("admin.logs.warning") }}</option>
          <option value="error">{{ $t("admin.logs.error") }}</option>
          <option value="fatal">{{ $t("admin.logs.fatal") }}</option>
        </select>
      </label>
      <label class="grid min-w-56 flex-1 gap-1 text-xs font-semibold text-[var(--theme-muted)]">
        {{ $t("admin.logs.eventContains") }}
        <input
          v-model="eventFilter"
          type="search"
          maxlength="120"
          :placeholder="$t('admin.logs.eventPlaceholder')"
          class="rounded-lg border border-[var(--theme-border)] bg-[var(--theme-background)] px-3 py-2 text-sm text-[var(--theme-text)]"
        />
      </label>
      <button
        type="submit"
        class="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50"
        :disabled="loading"
      >
        {{ $t("admin.logs.applyFilters") }}
      </button>
    </form>

    <p
      v-if="error"
      role="alert"
      class="mt-4 rounded-lg bg-[#f9e4dc] px-3 py-2 text-sm text-[#853c2a]"
    >
      {{ error }}
    </p>

    <div class="mt-4 max-h-[60vh] overflow-auto rounded-lg border border-[var(--theme-border)]">
      <table class="w-full border-collapse text-left text-sm">
        <thead
          class="sticky top-0 z-[1] bg-[var(--theme-sidebar)] text-xs text-[var(--theme-muted)]"
        >
          <tr>
            <th scope="col" class="whitespace-nowrap px-4 py-3 font-semibold">
              {{ $t("admin.logs.time") }}
            </th>
            <th scope="col" class="px-4 py-3 font-semibold">{{ $t("admin.logs.level") }}</th>
            <th scope="col" class="px-4 py-3 font-semibold">{{ $t("admin.logs.event") }}</th>
            <th scope="col" class="px-4 py-3 font-semibold">{{ $t("admin.logs.details") }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--theme-border)]">
          <tr v-for="log in logs" :key="log.id" class="align-top">
            <td class="whitespace-nowrap px-4 py-3 text-xs text-[var(--theme-muted)]">
              {{ formatDate(log.loggedAt) }}
            </td>
            <td class="px-4 py-3">
              <span
                class="rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-wider"
                :class="levelClass(log.level)"
              >
                {{ log.level }}
              </span>
            </td>
            <td class="max-w-64 break-all px-4 py-3 font-mono text-xs">{{ log.event }}</td>
            <td class="max-w-lg break-all px-4 py-3 font-mono text-xs text-[var(--theme-muted)]">
              {{ JSON.stringify(log.metadata) }}
            </td>
          </tr>
          <tr v-if="logs.length === 0 && !loading && !error">
            <td colspan="4" class="px-4 py-8 text-center text-sm text-[var(--theme-muted)]">
              {{ $t("admin.logs.noMatches") }}
            </td>
          </tr>
        </tbody>
      </table>
      <p
        v-if="loading && logs.length === 0"
        class="px-4 py-5 text-center text-sm text-[var(--theme-muted)]"
      >
        {{ $t("admin.logs.loadingLogs") }}
      </p>
    </div>

    <div v-if="cursor" class="mt-4 flex justify-center">
      <button
        class="rounded-lg border border-[var(--theme-border)] px-4 py-2 text-sm font-semibold transition hover:border-[var(--theme-accent)] disabled:opacity-50"
        :disabled="loading"
        @click="loadLogs(false)"
      >
        {{ loading ? $t("admin.logs.loading") : $t("admin.logs.loadOlder") }}
      </button>
    </div>
  </section>
</template>
