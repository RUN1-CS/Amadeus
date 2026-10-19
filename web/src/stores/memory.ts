import { defineStore } from "pinia";
import { ref } from "vue";

import type { Memory, MemoryPayload } from "@/types/chat";

const token = localStorage.getItem("amadeus_token");

export const useMemoryStore = defineStore("memory", () => {
  const memories = ref<Memory[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Fetch all memories for the user
  async function fetchMemories() {
    loading.value = true;
    error.value = null;
    if (!token) {
      error.value = "User is not authenticated.";
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
      if (!response.ok) throw new Error("Failed to fetch memories.");
      console.log("Fetched memories:", await response.clone());
      memories.value = await response.json();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "An error occurred.";
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
      if (!response.ok) throw new Error("Failed to create memory.");
      const newMemory: Memory = await response.json();
      memories.value.unshift(newMemory);
      return newMemory;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to create memory.";
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
      if (!response.ok) throw new Error("Failed to update memory.");
      const updated: Memory = await response.json();
      const index = memories.value.findIndex((m) => m.id === id);
      if (index !== -1) memories.value[index] = updated;
      return updated;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to update memory.";
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
      if (!response.ok) throw new Error("Failed to delete memory.");
      memories.value = memories.value.filter((m) => m.id !== id);
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Failed to delete memory.";
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
