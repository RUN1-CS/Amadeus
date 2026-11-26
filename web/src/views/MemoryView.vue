<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!-- Copyright (C) 2026 RUN1-CS -->

<!-- View for viewing, searching, creating, and editing memories. -->
<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { storeToRefs } from "pinia";
import BackToChatButton from "@/components/common/BackToChatButton.vue";
import { useMemoryStore } from "@/stores/memory";
import type { Memory } from "@/types/chat";

const memoryStore = useMemoryStore();
const { t } = useI18n();
const { memories, loading, error } = storeToRefs(memoryStore);

// Form state
const isEditing = ref(false);
const editingId = ref<number | null>(null);
const content = ref("");
const source = ref("user");
const metadataJson = ref("{}");
const searchFilter = ref("");
const formError = ref("");
const formSuccess = ref("");
const expandedMemories = ref<Record<number, boolean>>({});

onMounted(() => {
  memoryStore.fetchMemories();
});

// Filtered memories list based on search term
const filteredMemories = computed(() => {
  if (!searchFilter.value.trim()) return memories.value;
  const q = searchFilter.value.toLowerCase();
  return memories.value.filter(
    (m) => m.content.toLowerCase().includes(q) || m.source.toLowerCase().includes(q),
  );
});

function resetForm() {
  isEditing.value = false;
  editingId.value = null;
  content.value = "";
  source.value = "user";
  metadataJson.value = "{}";
  formError.value = "";
  formSuccess.value = "";
}

function startEdit(memory: Memory) {
  isEditing.value = true;
  editingId.value = memory.id;
  content.value = memory.content;
  source.value = memory.source;
  metadataJson.value = JSON.stringify(memory.metadata, null, 2);
  formError.value = "";
  formSuccess.value = "";
}

async function handleSubmit() {
  formError.value = "";
  formSuccess.value = "";

  // Validate JSON metadata format
  let parsedMetadata: Record<string, unknown> = {};
  try {
    parsedMetadata = JSON.parse(metadataJson.value || "{}");
  } catch {
    formError.value = t("memory.invalidMetadata");
    return;
  }

  try {
    if (isEditing.value && editingId.value !== null) {
      await memoryStore.updateMemory(editingId.value, {
        content: content.value,
        source: source.value,
        metadata: parsedMetadata,
      });
      formSuccess.value = t("memory.updated");
    } else {
      await memoryStore.createMemory({
        content: content.value,
        source: source.value,
        metadata: parsedMetadata,
      });
      formSuccess.value = t("memory.createdSuccessfully");
    }
    resetForm();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : t("memory.operationFailed");
  }
}

async function handleDelete(id: number) {
  if (!confirm(t("memory.confirmDelete"))) return;
  try {
    await memoryStore.deleteMemory(id);
  } catch (err) {
    formError.value = err instanceof Error ? err.message : t("memory.deleteFailed");
  }
}

function toggleMemoryExpanded(id: number) {
  expandedMemories.value[id] = !expandedMemories.value[id];
}
</script>

<template>
  <main
    class="min-h-screen bg-[var(--theme-background)] px-5 py-8 text-[var(--theme-text)] sm:px-10"
  >
    <section class="mx-auto max-w-4xl">
      <BackToChatButton />

      <div
        class="rounded-2xl border border-[#ddd8ce] bg-[var(--theme-surface)] p-7 shadow-sm sm:p-9"
      >
        <p class="font-mono text-[10px] uppercase tracking-widest text-[var(--theme-muted)]">
          {{ $t("memory.knowledgeBase") }}
        </p>
        <h1 class="mt-2 text-2xl font-bold">{{ $t("memory.management") }}</h1>
        <p class="mt-2 text-sm text-[var(--theme-muted)]">
          {{ $t("memory.description") }}
        </p>

        <!-- Form Section -->
        <form class="mt-8 space-y-4 border-b border-[#eeeae3] pb-8" @submit.prevent="handleSubmit">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-bold">
              {{ isEditing ? $t("memory.editMemory") : $t("memory.addMemory") }}
            </h2>
            <button
              v-if="isEditing"
              type="button"
              class="text-xs text-[var(--theme-accent)] hover:underline"
              @click="resetForm"
            >
              {{ $t("memory.cancelEdit") }}
            </button>
          </div>

          <label class="block text-sm font-semibold">
            {{ $t("memory.content") }}
            <textarea
              v-model="content"
              rows="3"
              required
              :placeholder="$t('memory.contentPlaceholder')"
              class="mt-2 w-full resize-y rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
            ></textarea>
          </label>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block text-sm font-semibold">
              {{ $t("memory.source") }}
              <input
                v-model="source"
                type="text"
                required
                :placeholder="$t('memory.sourcePlaceholder')"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              />
            </label>

            <label class="block text-sm font-semibold">
              {{ $t("memory.metadata") }}
              <span class="font-normal text-[var(--theme-muted)]">{{
                $t("memory.metadataJson")
              }}</span>
              <input
                v-model="metadataJson"
                type="text"
                :placeholder="$t('memory.metadataPlaceholder')"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              />
            </label>
          </div>

          <p v-if="formError" class="rounded-lg bg-[#f9e4dc] px-3 py-2 text-sm text-[#9e422c]">
            {{ formError }}
          </p>
          <p v-if="formSuccess" class="rounded-lg bg-[#e4f0df] px-3 py-2 text-sm text-[#47723e]">
            {{ formSuccess }}
          </p>

          <button
            type="submit"
            :disabled="loading"
            class="rounded-lg bg-[var(--theme-accent)] px-4 py-2.5 text-sm font-bold text-white hover:opacity-80 disabled:opacity-50"
          >
            {{ isEditing ? $t("memory.updateMemory") : $t("memory.saveMemory") }}
          </button>
        </form>

        <!-- Memory List Section -->
        <div class="mt-8">
          <div class="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <h2 class="text-sm font-bold">
              {{ $t("memory.storedMemories", { count: memories.length }) }}
            </h2>
            <input
              v-model="searchFilter"
              type="text"
              :placeholder="$t('memory.searchPlaceholder')"
              class="rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-1.5 text-sm outline-none focus:border-[var(--theme-accent)]"
            />
          </div>

          <p v-if="error" class="mb-4 rounded-lg bg-[#f9e4dc] px-3 py-2 text-sm text-[#9e422c]">
            {{ error }}
          </p>

          <div
            v-if="loading && memories.length === 0"
            class="py-6 text-center text-sm text-[var(--theme-muted)]"
          >
            {{ $t("memory.loading") }}
          </div>

          <div
            v-else-if="filteredMemories.length === 0"
            class="py-6 text-center text-sm text-[var(--theme-muted)]"
          >
            {{ $t("memory.empty") }}
          </div>

          <div v-else class="divide-y divide-[#eeeae3]">
            <article
              v-for="memory in filteredMemories"
              :key="memory.id"
              class="flex flex-col justify-between gap-4 py-4 sm:flex-row sm:items-start"
            >
              <div class="space-y-1">
                <p
                  class="text-sm font-medium"
                  :class="{ 'line-clamp-1': !expandedMemories[memory.id] }"
                >
                  {{ memory.content }}
                </p>
                <button
                  type="button"
                  class="text-xs text-[var(--theme-accent)] hover:underline"
                  :aria-expanded="Boolean(expandedMemories[memory.id])"
                  @click="toggleMemoryExpanded(memory.id)"
                >
                  {{ expandedMemories[memory.id] ? $t("app.showLess") : $t("app.showFull") }}
                </button>
                <div class="flex flex-wrap items-center gap-2 text-xs text-[var(--theme-muted)]">
                  <span class="rounded bg-[#eeeae3] px-2 py-0.5 font-mono text-[10px]">{{
                    memory.source
                  }}</span>
                  <span
                    >{{ $t("memory.created") }}
                    {{ new Date(memory.created_at).toLocaleDateString() }}</span
                  >
                  <span
                    v-if="Object.keys(memory.metadata || {}).length > 0"
                    class="font-mono text-[10px]"
                  >
                    {{ JSON.stringify(memory.metadata) }}
                  </span>
                </div>
              </div>

              <div class="flex items-center gap-3">
                <button
                  class="text-xs text-[var(--theme-accent)] hover:underline"
                  @click="startEdit(memory)"
                >
                  {{ $t("memory.edit") }}
                </button>
                <button
                  class="text-xs text-[#9e422c] hover:underline"
                  @click="handleDelete(memory.id)"
                >
                  {{ $t("memory.delete") }}
                </button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>
