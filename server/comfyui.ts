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

export type ImageAspect = "square" | "portrait" | "landscape";
export type ImageStyle =
  | "photo"
  | "anime"
  | "illustration"
  | "painting"
  | "3d"
  | "other";

export type GenerateOptions = {
  aspect?: ImageAspect;
  style?: ImageStyle;
  seed?: number;
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

// --- Workflow ---------------------------------------------------------------

type ModelProfile = {
  // Native resolutions the checkpoint was trained on, per aspect ratio.
  sizes: Record<ImageAspect, [width: number, height: number]>;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  // Second "hires fix" pass: upscale the latent, then re-denoise lightly to
  // add detail without changing the composition.
  hiresScale: number;
  hiresSteps: number;
  hiresDenoise: number;
};

const sd15Profile: ModelProfile = {
  sizes: { square: [512, 512], portrait: [512, 768], landscape: [768, 512] },
  steps: 30,
  cfg: 6,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  hiresScale: 1.5,
  hiresSteps: 24,
  hiresDenoise: 0.4,
};

const sdxlProfile: ModelProfile = {
  sizes: {
    square: [1024, 1024],
    portrait: [832, 1216],
    landscape: [1216, 832],
  },
  steps: 30,
  cfg: 5.5,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  hiresScale: 1.25,
  hiresSteps: 24,
  hiresDenoise: 0.35,
};

// Optional standalone VAE (file name in ComfyUI's models/vae folder). Many SD 1.5
// checkpoints ship a weak baked-in VAE that blurs fine lines; setting e.g.
// COMFYUI_VAE=vae-ft-mse-840000-ema-pruned.safetensors fixes that.
const externalVae = process.env.COMFYUI_VAE?.trim() || undefined;

// Set to false if generation gets too slow or runs out of VRAM.
const enableHiresFix = true;

function getModelProfile(model: string): ModelProfile {
  return /xl|pony|illustrious|noobai/i.test(model) ? sdxlProfile : sd15Profile;
}

type WorkflowNode = { class_type: string; inputs: Record<string, unknown> };
type NodeLink = [nodeId: string, outputIndex: number];

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 32);
}

function workflow(
  model: string,
  positivePrompt: string,
  negativePrompt: string,
  { aspect = "square", style = "other", seed }: GenerateOptions,
  resolvedSeed: number,
) {
  const profile = getModelProfile(model);
  const [width, height] = profile.sizes[aspect];
  // Anime SD 1.5 checkpoints are usually trained with CLIP skip 2.
  const useClipSkip = profile === sd15Profile && style === "anime";
  const clip: NodeLink = useClipSkip ? ["10", 0] : ["4", 1];
  const vae: NodeLink = externalVae ? ["13", 0] : ["4", 2];

  const nodes: Record<string, WorkflowNode> = {
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: model },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: positivePrompt, clip },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: { text: negativePrompt, clip },
    },
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: resolvedSeed,
        steps: profile.steps,
        cfg: profile.cfg,
        sampler_name: profile.sampler,
        scheduler: profile.scheduler,
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
  };

  if (useClipSkip) {
    nodes["10"] = {
      class_type: "CLIPSetLastLayer",
      inputs: { stop_at_clip_layer: -2, clip: ["4", 1] },
    };
  }

  let samples: NodeLink = ["3", 0];

  if (externalVae) {
    nodes["13"] = {
      class_type: "VAELoader",
      inputs: { vae_name: externalVae },
    };
  }

  if (enableHiresFix) {
    // Upscale in pixel space (decode -> Lanczos -> encode). Upscaling the latent
    // directly produces jagged, noisy edges that the second pass then keeps.
    nodes["14"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["3", 0], vae },
    };
    nodes["11"] = {
      class_type: "ImageScaleBy",
      inputs: {
        image: ["14", 0],
        upscale_method: "lanczos",
        scale_by: profile.hiresScale,
      },
    };
    nodes["15"] = {
      class_type: "VAEEncode",
      inputs: { pixels: ["11", 0], vae },
    };
    nodes["12"] = {
      class_type: "KSampler",
      inputs: {
        seed: resolvedSeed,
        steps: profile.hiresSteps,
        cfg: profile.cfg,
        sampler_name: profile.sampler,
        scheduler: profile.scheduler,
        denoise: profile.hiresDenoise,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["15", 0],
      },
    };
    samples = ["12", 0];
  }

  nodes["8"] = {
    class_type: "VAEDecode",
    inputs: { samples, vae },
  };
  nodes["9"] = {
    class_type: "SaveImage",
    inputs: { filename_prefix: "amadeus", images: ["8", 0] },
  };

  return nodes;
}

// --- Queueing and polling ---------------------------------------------------

type ComfyHistoryEntry = {
  outputs?: Record<string, { images?: ComfyImage[] }>;
  status?: {
    status_str?: string;
    messages?: Array<[string, Record<string, unknown>]>;
  };
};

const generationTimeoutMs = 5 * 60_000;

async function waitForImage(promptId: string): Promise<ComfyImage> {
  const deadline = Date.now() + generationTimeoutMs;
  while (Date.now() < deadline) {
    const response = await comfyFetch(`/history/${promptId}`);
    if (!response.ok)
      throw new Error(`ComfyUI returned HTTP ${response.status}.`);
    const history = (await response.json()) as Record<
      string,
      ComfyHistoryEntry
    >;
    const entry = history[promptId];

    if (entry?.status?.status_str === "error") {
      const failure = entry.status.messages?.find(
        ([type]) => type === "execution_error",
      )?.[1];
      const detail =
        typeof failure?.exception_message === "string"
          ? failure.exception_message.trim()
          : "unknown error";
      throw new Error(`ComfyUI failed to generate the image: ${detail}`);
    }

    const images = Object.values(entry?.outputs ?? {}).flatMap(
      (output) => output.images ?? [],
    );
    const image =
      images.find(
        (candidate) => candidate.filename && candidate.type === "output",
      ) ?? images.find((candidate) => candidate.filename);
    if (image) return image;

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("ComfyUI did not finish generating an image in time.");
}

// ComfyUI answers invalid workflows with a JSON body that names the failing
// node (missing checkpoint, bad sampler, ...). Surface it instead of a bare 400.
async function readComfyError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; details?: string } | string;
      node_errors?: Record<
        string,
        { errors?: Array<{ message?: string; details?: string }> }
      >;
    };
    const parts: string[] = [];
    if (typeof body.error === "string") parts.push(body.error);
    else if (body.error?.message) parts.push(body.error.message);
    for (const node of Object.values(body.node_errors ?? {})) {
      for (const nodeError of node.errors ?? []) {
        const text = [nodeError.message, nodeError.details]
          .filter(Boolean)
          .join(": ");
        if (text) parts.push(text);
      }
    }
    return parts.join("; ");
  } catch {
    return "";
  }
}

function mergeNegative(...parts: string[]) {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const part of parts) {
    for (const raw of part.split(/,(?![^(]*\))/)) {
      const term = raw.trim();
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
  }
  return terms.join(", ");
}

export async function generateImage(
  model: string,
  positivePrompt: string,
  negativePrompt: string,
  options: GenerateOptions = {},
) {
  if (!model) throw new Error("Choose a ComfyUI checkpoint.");
  if (!positivePrompt.trim()) throw new Error("Enter a positive image prompt.");

  const seed =
    options.seed !== undefined &&
    Number.isInteger(options.seed) &&
    options.seed >= 0
      ? options.seed
      : randomSeed();

  const response = await comfyFetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: workflow(
        model,
        positivePrompt.trim(),
        mergeNegative(comfyUiNegativePrompt, negativePrompt),
        options,
        seed,
      ),
      client_id: randomUUID(),
    }),
  });
  if (!response.ok) {
    const detail = await readComfyError(response);
    throw new Error(
      `ComfyUI rejected the workflow (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  const result = (await response.json()) as {
    prompt_id?: string;
    error?: string;
  };
  if (!result.prompt_id)
    throw new Error(result.error ?? "ComfyUI returned no prompt ID.");

  logger.info(
    {
      event: "comfyui.generation_queued",
      model,
      aspect: options.aspect ?? "square",
      style: options.style ?? "other",
      seed,
    },
    "Queued ComfyUI image generation",
  );
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
