// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Vector embeddings for messages so related memories can be recalled.
import { embeddingModel, keepAlive } from "../config.js";
import { getErrorType, logger } from "../logger.js";
import { ollama } from "./client.js";

// Create a vector embedding for a message so related memories can be recalled.
export async function embedText(text: string) {
  if (!text.trim()) return undefined;
  try {
    const response = await ollama.embed({
      model: embeddingModel,
      input: text.slice(0, 8_000),
      keep_alive: keepAlive,
    });
    return response.embeddings[0];
  } catch (error) {
    logger.warn(
      { event: "ai.message_embedding_failed", errorType: getErrorType(error) },
      "Could not create message embedding",
    );
    return undefined;
  }
}

// Public wrapper for embedding a prompt or assistant reply.
export async function getMessageEmbedding(text: string) {
  return embedText(text);
}
