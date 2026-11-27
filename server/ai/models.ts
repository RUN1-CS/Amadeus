// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Ollama model discovery: the cached model list, per-model context window and
// tool support, and freeing VRAM before image generation.
import { configuredContextWindow } from "../config.js";
import { getErrorMessage } from "../errors.js";
import { getErrorType, logger } from "../logger.js";
import { ollama } from "./client.js";

type OllamaModels = unknown[];

export type ModelInfo = { contextWindow: number; tools: boolean };

let cachedModels: OllamaModels = [];
let modelLoadError: string | undefined;

// Cache the promise so concurrent requests share one `show` call.
const modelInfoCache = new Map<string, Promise<ModelInfo>>();

// Refresh the cached Ollama model list and keep the last load error available.
export async function loadModels(): Promise<OllamaModels> {
  try {
    const response = await ollama.list();
    cachedModels = response.models;
    modelLoadError = undefined;
  } catch (error) {
    modelLoadError = getErrorMessage(error);
    logger.error(
      { event: "ollama.model_load_failed", errorType: getErrorType(error) },
      "Could not load Ollama models",
    );
  }
  return cachedModels;
}

// Return the last known model list and any load failure for the client.
export function getModels() {
  return { models: cachedModels, error: modelLoadError };
}

// Read the usable context window and tool support from a single `show` call.
async function fetchModelInfo(model: string): Promise<ModelInfo> {
  const details = await ollama.show({ model });

  const modelInfo = details.model_info as unknown;
  const contextEntry =
    modelInfo instanceof Map
      ? [...modelInfo.entries()].find(([key]) =>
          key.endsWith(".context_length"),
        )
      : Object.entries((modelInfo ?? {}) as Record<string, unknown>).find(
          ([key]) => key.endsWith(".context_length"),
        );
  const modelMaxContextWindow =
    typeof contextEntry?.[1] === "number"
      ? contextEntry[1]
      : configuredContextWindow;
  const contextWindow = Math.min(
    modelMaxContextWindow,
    configuredContextWindow,
  );

  const capabilities = (details as { capabilities?: unknown }).capabilities;
  const tools = Array.isArray(capabilities) && capabilities.includes("tools");
  logger.info({
    event: "ai.model_capabilities_loaded",
    toolSupport: tools ? "enabled" : "disabled",
  });

  return { contextWindow, tools };
}

// Resolve context window and tool support for a model, cached per model.
export function getModelInfo(model: string): Promise<ModelInfo> {
  const cached = modelInfoCache.get(model);
  if (cached) return cached;

  const pending = fetchModelInfo(model).catch((error) => {
    logger.warn(
      {
        event: "ai.model_info_load_failed",
        errorType: getErrorType(error),
        usingDefaults: true,
      },
      "Could not load model information; using defaults",
    );
    // Don't cache failures forever: let the next request retry.
    modelInfoCache.delete(model);
    return { contextWindow: configuredContextWindow, tools: false };
  });
  modelInfoCache.set(model, pending);
  return pending;
}

// When Ollama and ComfyUI share one GPU, free the chat model's VRAM before
// generating an image. Opt in with UNLOAD_MODEL_BEFORE_IMAGE=true.
export async function releaseModelForImage(model: string) {
  if (!model || process.env.UNLOAD_MODEL_BEFORE_IMAGE !== "true") return;
  try {
    await ollama.generate({ model, prompt: "", keep_alive: 0 });
    logger.info({ event: "ai.model_unloaded" }, "Model unloaded.");
  } catch (error) {
    logger.warn(
      { event: "ai.model_unload_failed", errorType: getErrorType(error) },
      "Could not unload model",
    );
    throw error;
  }
}
