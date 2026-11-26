import { defineStore } from "pinia";
import { ref } from "vue";

import i18n from "@/i18n";
import { createServerError, type ServerErrorPayload } from "@/services/serverErrors";
import type { Memory, MemoryPayload } from "@/types/chat";

async function throwResponseError(response: Response, fallback: string) {
  if (!response.ok) {
    const payload = (await response.json()) as ServerErrorPayload;
    throw createServerError(payload, fallback);
  }
}

function authHeaders(includeJsonContentType = true) {
  const headers = new Headers();
  if (includeJsonContentType) headers.set("Content-Type", "application/json");
  const token = localStorage.getItem("amadeus_token");
  if (token) headers.set("Authorization", "Bearer " + token);
  return headers;
}

export const useMemoryStore = defineStore("memory", () => {
  const memories = ref<Memory[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchMemories() {
    loading.value = true;
    error.value = null;
    if (!localStorage.getItem("amadeus_token")) {
      error.value = i18n.global.t("memory.userNotAuthenticated");
      loading.value = false;
      return;
    }
    try {
      const response = await fetch("/api/memories", {
        headers: authHeaders(),
      });
      await throwResponseError(response, i18n.global.t("memory.fetchFailed"));
      const body = (await response.json()) as { memories: Memory[] };
      memories.value = body.memories;
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t("memory.fetchFailed");
    } finally {
      loading.value = false;
    }
  }

  async function createMemory(payload: MemoryPayload) {
    loading.value = true;
    error.value = null;
    try {
      const response = await fetch("/api/memories", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      await throwResponseError(response, i18n.global.t("memory.createFailed"));
      const body = (await response.json()) as { memory: Memory };
      const newMemory = body.memory;
      memories.value.unshift(newMemory);
      return newMemory;
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t("memory.createFailed");
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function updateMemory(id: number, payload: Partial<MemoryPayload>) {
    loading.value = true;
    error.value = null;
    try {
      const response = await fetch(`/api/memories/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      await throwResponseError(response, i18n.global.t("memory.updateFailed"));
      const body = (await response.json()) as { memory: Memory };
      const updated = body.memory;
      const index = memories.value.findIndex((memory) => memory.id === id);
      if (index !== -1) memories.value[index] = updated;
      return updated;
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t("memory.updateFailed");
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function deleteMemory(id: number) {
    loading.value = true;
    error.value = null;
    try {
      const response = await fetch(`/api/memories/${id}`, {
        method: "DELETE",
        headers: authHeaders(false),
      });
      await throwResponseError(response, i18n.global.t("memory.deleteRequestFailed"));
      memories.value = memories.value.filter((memory) => memory.id !== id);
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
