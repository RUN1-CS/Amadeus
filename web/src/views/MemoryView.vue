<!-- View for viewing, searching, creating, and editing memories. -->
<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { useMemoryStore } from "@/stores/memory";
import type { Memory } from "@/types/chat";

const router = useRouter();
const memoryStore = useMemoryStore();
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
    formError.value = "Metadata must be valid JSON.";
    return;
  }

  try {
    if (isEditing.value && editingId.value !== null) {
      await memoryStore.updateMemory(editingId.value, {
        content: content.value,
        source: source.value,
        metadata: parsedMetadata,
      });
      formSuccess.value = "Memory updated successfully.";
    } else {
      await memoryStore.createMemory({
        content: content.value,
        source: source.value,
        metadata: parsedMetadata,
      });
      formSuccess.value = "Memory created successfully.";
    }
    resetForm();
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Operation failed.";
  }
}

async function handleDelete(id: number) {
  if (!confirm("Are you sure you want to delete this memory?")) return;
  try {
    await memoryStore.deleteMemory(id);
  } catch (err) {
    formError.value = err instanceof Error ? err.message : "Delete failed.";
  }
}
</script>

<template>
  <main
    class="min-h-screen bg-[var(--theme-background)] px-5 py-8 text-[var(--theme-text)] sm:px-10"
  >
    <section class="mx-auto max-w-4xl">
      <button
        class="mb-8 text-sm text-[var(--theme-accent)] hover:underline"
        @click="router.push('/')"
      >
        ← Back to chat
      </button>

      <div
        class="rounded-2xl border border-[#ddd8ce] bg-[var(--theme-surface)] p-7 shadow-sm sm:p-9"
      >
        <p class="font-mono text-[10px] uppercase tracking-widest text-[var(--theme-muted)]">
          Knowledge Base
        </p>
        <h1 class="mt-2 text-2xl font-bold">Memory Management</h1>
        <p class="mt-2 text-sm text-[var(--theme-muted)]">
          View and manage custom context and stored memories for your assistant.
        </p>

        <!-- Form Section -->
        <form class="mt-8 space-y-4 border-b border-[#eeeae3] pb-8" @submit.prevent="handleSubmit">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-bold">
              {{ isEditing ? "Edit Memory" : "Add New Memory" }}
            </h2>
            <button
              v-if="isEditing"
              type="button"
              class="text-xs text-[var(--theme-accent)] hover:underline"
              @click="resetForm"
            >
              Cancel Edit
            </button>
          </div>

          <label class="block text-sm font-semibold">
            Content
            <textarea
              v-model="content"
              rows="3"
              required
              placeholder="Enter the memory fact or snippet..."
              class="mt-2 w-full resize-y rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
            ></textarea>
          </label>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block text-sm font-semibold">
              Source
              <input
                v-model="source"
                type="text"
                required
                placeholder="e.g., user, chat, system"
                class="mt-2 w-full rounded-lg border border-[#d8d2c7] bg-[var(--theme-background)] px-3 py-2.5 outline-none focus:border-[var(--theme-accent)]"
              />
            </label>

            <label class="block text-sm font-semibold">
              Metadata <span class="font-normal text-[var(--theme-muted)]">(JSON)</span>
              <input
                v-model="metadataJson"
                type="text"
                placeholder='{"category": "preference"}'
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
            {{ isEditing ? "Update Memory" : "Save Memory" }}
          </button>
        </form>

        <!-- Memory List Section -->
        <div class="mt-8">
          <div class="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <h2 class="text-sm font-bold">Stored Memories ({{ memories.length }})</h2>
            <input
              v-model="searchFilter"
              type="text"
              placeholder="Search memories..."
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
            Loading memories...
          </div>

          <div
            v-else-if="filteredMemories.length === 0"
            class="py-6 text-center text-sm text-[var(--theme-muted)]"
          >
            No memories found.
          </div>

          <div v-else class="divide-y divide-[#eeeae3]">
            <article
              v-for="memory in filteredMemories"
              :key="memory.id"
              class="flex flex-col justify-between gap-4 py-4 sm:flex-row sm:items-start"
            >
              <div class="space-y-1">
                <p class="text-sm font-medium">{{ memory.content }}</p>
                <div class="flex flex-wrap items-center gap-2 text-xs text-[var(--theme-muted)]">
                  <span class="rounded bg-[#eeeae3] px-2 py-0.5 font-mono text-[10px]">{{
                    memory.source
                  }}</span>
                  <span>Created: {{ new Date(memory.created_at).toLocaleDateString() }}</span>
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
                  Edit
                </button>
                <button
                  class="text-xs text-[#9e422c] hover:underline"
                  @click="handleDelete(memory.id)"
                >
                  Delete
                </button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>
