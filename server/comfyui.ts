// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { randomUUID } from "node:crypto";

import { comfyUiBaseUrl, comfyUiNegativePrompt } from "./config.js";
import { getErrorMessage } from "./errors.js";
import { getErrorType, logger } from "./logger.js";

type ComfyImage = {
  filename: string;
  subfolder: string;
  type: string;
};

let cachedModels: string[] = [];
let modelLoadError: string | undefined;

interface ComfyObjectInfo {
  CheckpointLoaderSimple?: {
    input?: {
      required?: {
        ckpt_name?: [string[], ...unknown[]];
      };
    };
  };
}

function getCheckpointNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((model): model is string => typeof model === "string")
    : [];
}

async function comfyFetch(path: string, init?: RequestInit) {
  const baseUrl = comfyUiBaseUrl.replace(/\/+$/, "");
  return fetch(`${baseUrl}${path}`, init);
}

export async function loadComfyModels(): Promise<string[]> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [objectInfoResponse, modelsResponse] = await Promise.all([
        comfyFetch("/object_info/CheckpointLoaderSimple"),
        comfyFetch("/models/checkpoints"),
      ]);

      const models = new Set<string>();

      if (objectInfoResponse.ok) {
        const objectInfo = (await objectInfoResponse.json()) as ComfyObjectInfo;
        const nodeModels =
          objectInfo.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
        getCheckpointNames(nodeModels).forEach((model) => models.add(model));
      }

      if (modelsResponse.ok) {
        const listedModels = getCheckpointNames(await modelsResponse.json());
        listedModels.forEach((model) => models.add(model));
      }

      if (models.size === 0) {
        throw new Error(
          `ComfyUI returned no checkpoints (object info HTTP ${objectInfoResponse.status}, models HTTP ${modelsResponse.status}).`,
        );
      }

      cachedModels = [...models];
      modelLoadError = undefined;

      return cachedModels;
    } catch (error) {
      modelLoadError = getErrorMessage(error);

      if (attempt === 4) {
        logger.error(
          {
            event: "comfyui.model_load_failed",
            errorType: getErrorType(error),
          },
          "Could not load ComfyUI models",
        );
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return cachedModels;
}

export function getComfyModels() {
  return {
    models: cachedModels,
    defaultNegativePrompt: comfyUiNegativePrompt,
    error: modelLoadError,
  };
}

function workflow(
  model: string,
  positivePrompt: string,
  negativePrompt: string,
) {
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: Math.floor(Math.random() * 2 ** 32),
        steps: 20,
        cfg: 7,
        sampler_name: "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: model },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width: 512, height: 512, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: positivePrompt, clip: ["4", 1] },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip: ["4", 1] },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae: ["4", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { filename_prefix: "amadeus", images: ["8", 0] },
    },
  };
}

async function waitForImage(promptId: string): Promise<ComfyImage> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await comfyFetch(`/history/${promptId}`);
    if (!response.ok)
      throw new Error(`ComfyUI returned HTTP ${response.status}.`);
    const history = (await response.json()) as Record<
      string,
      { outputs?: Record<string, { images?: ComfyImage[] }> }
    >;
    const outputs = history[promptId]?.outputs;
    const image = Object.values(outputs ?? {})
      .flatMap((output) => output.images ?? [])
      .find((candidate) => candidate.filename);
    if (image) return image;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("ComfyUI did not finish generating an image in time.");
}

export async function generateImage(
  model: string,
  positivePrompt: string,
  negativePrompt: string,
) {
  if (!model) throw new Error("Choose a ComfyUI checkpoint.");
  if (!positivePrompt.trim()) throw new Error("Enter a positive image prompt.");
  const response = await comfyFetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: workflow(
        model,
        positivePrompt.trim(),
        [comfyUiNegativePrompt, negativePrompt.trim()]
          .filter(Boolean)
          .join(", "),
      ),
      client_id: randomUUID(),
    }),
  });
  if (!response.ok) {
    throw new Error(`ComfyUI rejected the workflow (HTTP ${response.status}).`);
  }
  const result = (await response.json()) as {
    prompt_id?: string;
    error?: string;
  };
  if (!result.prompt_id)
    throw new Error(result.error ?? "ComfyUI returned no prompt ID.");
  return waitForImage(result.prompt_id);
}

export async function getComfyImage(image: ComfyImage) {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  const response = await comfyFetch(`/view?${params}`);
  if (!response.ok)
    throw new Error(`ComfyUI returned HTTP ${response.status}.`);
  return response;
}
