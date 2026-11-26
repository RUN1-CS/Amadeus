// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ollama = vi.hoisted(() => ({
  list: vi.fn(),
  show: vi.fn(),
  chat: vi.fn(),
}));

vi.mock("../ai/client.js", () => ({ ollama }));

import { chatWithTools } from "../ai/chat.js";
import { getModelInfo, getModels, loadModels } from "../ai/models.js";

const request = {
  model: "test-model",
  messages: [],
  think: false,
  stream: true,
  contextWindow: 2048,
  tools: undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Ollama integration failures", () => {
  it("reports Ollama unavailable during model discovery", async () => {
    ollama.list.mockRejectedValue(new Error("Ollama unavailable"));

    await expect(loadModels()).resolves.toEqual([]);
    expect(getModels()).toEqual({
      models: [],
      error: "Ollama unavailable",
    });
  });

  it("uses safe defaults when the requested model is unavailable", async () => {
    ollama.show.mockRejectedValue(new Error("model not found"));

    await expect(getModelInfo(`missing-${Date.now()}`)).resolves.toEqual({
      contextWindow: 4096,
      tools: false,
    });
  });

  it("surfaces an interrupted generation after delivering received chunks", async () => {
    async function* interruptedStream() {
      yield { message: { content: "partial" } };
      throw new Error("Generation interrupted");
    }
    ollama.chat.mockResolvedValue(interruptedStream());
    const chunks: unknown[] = [];

    await expect(
      chatWithTools(request as never, (chunk) => chunks.push(chunk)),
    ).rejects.toThrow("Generation interrupted");
    expect(chunks).toEqual([{ content: "partial", thinking: "" }]);
  });

  it("rejects an empty streaming response as malformed", async () => {
    async function* emptyStream() {}
    ollama.chat.mockResolvedValue(emptyStream());

    await expect(
      chatWithTools(request as never, vi.fn()),
    ).rejects.toThrow("Ollama returned an empty response.");
  });
});

describe("ComfyUI integration failures", () => {
  it("reports ComfyUI unavailable after retrying model discovery", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    const { getComfyModels, loadComfyModels } = await import("../comfyui.js");
    const loading = loadComfyModels();
    await vi.runAllTimersAsync();
    await expect(loading).resolves.toEqual([]);
    expect(getComfyModels()).toMatchObject({
      models: [],
      error: "fetch failed",
    });
  });

  it("reports a rejected ComfyUI image-generation request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    );
    const { generateImage } = await import("../comfyui.js");

    await expect(
      generateImage("checkpoint", "a landscape", ""),
    ).rejects.toThrow("ComfyUI rejected the workflow (HTTP 503).");
  });
});
