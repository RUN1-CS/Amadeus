// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Assembles the final chat payload for Ollama: model info, memory, prompt, tools.
import type { ClientMessage } from "../protocol.js";
import type { SavedMessage } from "../types.js";
import { fitMessages } from "./context.js";
import { searchMessageMemory } from "./memory.js";
import { getModelInfo } from "./models.js";
import { buildSystemPrompt } from "./prompt.js";
import { getConfiguredTools } from "./tools/tool-loop.js";

// Assemble the final chat payload, memory prompt, and tool config for Ollama.
export async function buildChatRequest(
  userId: number,
  userName: string,
  aboutMe: string,
  customBehavior: string,
  data: ClientMessage,
  history: SavedMessage[],
) {
  const model = data.model ?? "";
  const prompt = data.prompt ?? "";

  // Independent lookups run in parallel. Memory search embeds the original
  // prompt, so persona instructions never skew the similarity results.
  const [{ contextWindow, tools: toolsSupported }, memory] = await Promise.all([
    getModelInfo(model),
    searchMessageMemory(userId, prompt),
  ]);
  const tools = toolsSupported ? await getConfiguredTools() : undefined;

  const systemPrompt = buildSystemPrompt({
    userName,
    aboutMe,
    customBehavior,
    tsundere: data.tsundere,
    messageMemory: memory.context,
    hasTools: Boolean(tools?.length),
  });

  return {
    model,
    messages: fitMessages(
      history,
      systemPrompt,
      prompt,
      contextWindow,
      data.images,
    ),
    tools,
    think: data.thinking ?? false,
    stream: data.stream ?? false,
    contextWindow,
    // Reused by the caller when saving the user message, so it isn't embedded twice.
    promptEmbedding: memory.embedding,
  };
}

export type BuiltChatRequest = Awaited<ReturnType<typeof buildChatRequest>>;
