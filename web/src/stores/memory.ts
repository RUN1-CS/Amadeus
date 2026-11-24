import { defineStore } from "pinia";
import { ref } from "vue";

import i18n from "@/i18n";
import { createServerError, type ServerErrorPayload } from "@/services/serverErrors";
import type { Memory, MemoryPayload } from "@/types/chat";

const token = localStorage.getItem("amadeus_token");

async function throwResponseError(response: Response, fallback: string) {
  if (!response.ok) {
    const payload = (await response.json()) as ServerErrorPayload;
    throw createServerError(payload, fallback);
  }
}

export const useMemoryStore = defineStore("memory", () => {
  const memories = ref<Memory[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Fetch all memories for the user
  async function fetchMemories() {
    loading.value = true;
    error.value = null;
    if (!token) {
      error.value = i18n.global.t("memory.userNotAuthenticated");
      loading.value = false;
      return;
    }
    try {
      const response = await fetch("/api/memories", {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      await throwResponseError(response, i18n.global.t("memory.fetchFailed"));
      console.log("Fetched memories:", await response.clone());
      memories.value = await response.json();
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t("memory.fetchFailed");
    } finally {
      loading.value = false;
    }
  }

  // Create a new memory
  async function createMemory(payload: MemoryPayload) {
    loading.value = true;
    error.value = null;
    try {
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      await throwResponseError(response, i18n.global.t("memory.createFailed"));
      const newMemory: Memory = await response.json();
      memories.value.unshift(newMemory);
      return newMemory;
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t("memory.createFailed");
      throw err;
    } finally {
      loading.value = false;
    }
  }

  // Update an existing memory
  async function updateMemory(id: number, payload: Partial<MemoryPayload>) {
    loading.value = true;
    error.value = null;
    try {
      const response = await fetch(`/api/memories/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      await throwResponseError(response, i18n.global.t("memory.updateFailed"));
      const updated: Memory = await response.json();
      const index = memories.value.findIndex((m) => m.id === id);
      if (index !== -1) memories.value[index] = updated;
      return updated;
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t("memory.updateFailed");
      throw err;
    } finally {
      loading.value = false;
    }
  }

  // Delete a memory
  async function deleteMemory(id: number) {
    loading.value = true;
    error.value = null;
    try {
      const response = await fetch(`/api/memories/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      await throwResponseError(response, i18n.global.t("memory.deleteRequestFailed"));
      memories.value = memories.value.filter((m) => m.id !== id);
    } catch (err) {
      error.value =
        err instanceof Error ? err.message : i18n.global.t("memory.deleteRequestFailed");
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    memories,
    loading,
    error,
    fetchMemories,
    createMemory,
    updateMemory,
    deleteMemory,
  };
});
