import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useMemoryStore } from "@/stores/memory";
import type { Memory } from "@/types/chat";

const savedMemory: Memory = {
  id: 12,
  user_id: 3,
  content: "Prefers concise answers",
  source: "manual",
  metadata: {},
  created_at: "2026-11-26T17:00:00.000Z",
  updated_at: "2026-11-26T17:00:00.000Z",
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Memory store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.setItem("amadeus_token", "session-token");
  });

  it("unwraps memory API responses and updates using the supported method", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/memories" && !init?.method) {
        return jsonResponse({ memories: [savedMemory] });
      }
      if (path === "/api/memories" && init?.method === "POST") {
        return jsonResponse({
          memory: { ...savedMemory, id: 13, content: "Likes clear explanations" },
        });
      }
      if (path === "/api/memories/12" && init?.method === "PATCH") {
        return jsonResponse({
          memory: { ...savedMemory, content: "Updated preference" },
        });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = useMemoryStore();
    await store.fetchMemories();
    expect(store.memories).toEqual([savedMemory]);
    expect(store.memories[0]?.created_at).toBe(savedMemory.created_at);

    await store.createMemory({ content: savedMemory.content, source: savedMemory.source });
    expect(store.memories.map((memory) => memory.id)).toEqual([13, 12]);

    const updated = await store.updateMemory(12, { content: "Updated preference" });
    expect(updated.content).toBe("Updated preference");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/memories/12",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(store.memories[1]?.content).toBe("Updated preference");
  });
});
