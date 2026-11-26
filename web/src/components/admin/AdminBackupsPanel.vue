<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import { createApiClient } from "@/services/api";
import { useOllamaStore } from "@/stores/ollama";

type BackupSettings = {
  enabled: boolean;
  maxUploadBytes: number;
};

const store = useOllamaStore();
const { t } = useI18n();
const { token } = storeToRefs(store);
const api = createApiClient(() => token.value);
const settings = ref<BackupSettings | null>(null);
const selectedFile = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const loading = ref(false);
const error = ref("");
const message = ref("");

async function loadSettings() {
  error.value = "";
  try {
    settings.value = await api.request<BackupSettings>("/api/admin/backups");
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : t("admin.backups.couldNotLoad");
  }
}

async function downloadBackup() {
  loading.value = true;
  error.value = "";
  message.value = "";
  try {
    const response = await api.requestResponse("/api/admin/backups", {
      method: "POST",
    });
    const blob = await response.blob();
    const filename =
      response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
      "amadeus-backup.dump";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    message.value = t("admin.backups.created");
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : t("admin.backups.couldNotCreate");
  } finally {
    loading.value = false;
  }
}

function selectFile(event: Event) {
  selectedFile.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  error.value = "";
  message.value = "";
}

async function restoreBackup() {
  const file = selectedFile.value;
  if (!file || loading.value) return;
  if (!window.confirm(t("admin.backups.restoreConfirmation", { filename: file.name }))) {
    return;
  }

  loading.value = true;
  error.value = "";
  message.value = "";
  try {
    await api.request<{ restored: boolean }>("/api/admin/backups/restore", {
      method: "POST",
      body: file,
    });
    selectedFile.value = null;
    if (fileInput.value) fileInput.value.value = "";
    message.value = t("admin.backups.restored");
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : t("admin.backups.couldNotRestore");
  } finally {
    loading.value = false;
  }
}

function formatBytes(bytes: number) {
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: "byte",
    unitDisplay: "narrow",
    maximumFractionDigits: 1,
  }).format(bytes);
}

onMounted(() => void loadSettings());
</script>

<template>
  <section
    class="mt-6 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-6"
  >
    <div>
      <h2 class="text-lg font-bold">{{ $t("admin.backups.title") }}</h2>
      <p class="mt-1 text-sm text-[var(--theme-muted)]">
        {{ $t("admin.backups.description") }}
      </p>
    </div>

    <p
      v-if="error"
      role="alert"
      class="mt-4 rounded-lg bg-[#f9e4dc] px-3 py-2 text-sm text-[#853c2a]"
    >
      {{ error }}
    </p>
    <p
      v-if="message"
      role="status"
      class="mt-4 rounded-lg bg-[#e2f0e5] px-3 py-2 text-sm text-[#356c40]"
    >
      {{ message }}
    </p>

    <p v-if="settings && !settings.enabled" class="mt-4 text-sm text-[var(--theme-muted)]">
      {{ $t("admin.backups.disabled") }}
    </p>

    <div v-else-if="settings" class="mt-5 grid gap-5 lg:grid-cols-2">
      <div class="rounded-lg border border-[var(--theme-border)] p-4">
        <h3 class="font-semibold">{{ $t("admin.backups.createTitle") }}</h3>
        <p class="mt-1 text-sm text-[var(--theme-muted)]">
          {{ $t("admin.backups.createDescription") }}
        </p>
        <button
          class="mt-4 rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-50"
          :disabled="loading"
          @click="downloadBackup"
        >
          {{ loading ? $t("admin.backups.working") : $t("admin.backups.create") }}
        </button>
      </div>

      <div class="rounded-lg border border-[var(--theme-border)] p-4">
        <h3 class="font-semibold">{{ $t("admin.backups.restoreTitle") }}</h3>
        <p class="mt-1 text-sm text-[var(--theme-muted)]">
          {{
            $t("admin.backups.restoreDescription", {
              maxUpload: formatBytes(settings.maxUploadBytes),
            })
          }}
        </p>
        <input
          ref="fileInput"
          type="file"
          accept=".dump,.backup,application/octet-stream"
          class="mt-4 block w-full text-sm text-[var(--theme-muted)] file:mr-3 file:rounded-lg file:border file:border-[var(--theme-border)] file:bg-[var(--theme-background)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--theme-text)]"
          :disabled="loading"
          @change="selectFile"
        />
        <p v-if="selectedFile" class="mt-2 break-all text-xs text-[var(--theme-muted)]">
          {{ selectedFile.name }} · {{ formatBytes(selectedFile.size) }}
        </p>
        <button
          class="mt-4 rounded-lg border border-[#e7b6a4] px-4 py-2 text-sm font-semibold text-[#853c2a] transition hover:bg-[#f9e4dc] disabled:opacity-50"
          :disabled="loading || !selectedFile"
          @click="restoreBackup"
        >
          {{ loading ? $t("admin.backups.working") : $t("admin.backups.restore") }}
        </button>
      </div>
    </div>
  </section>
</template>
