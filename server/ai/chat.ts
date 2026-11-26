// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Runs chat rounds against Ollama, including the browser tool-calling loop.
import type { ChatResponse, Message, ToolCall } from "ollama";

import {
  keepAlive,
  maxToolErrorChars,
  maxToolResultChars,
  maxToolRounds,
  minEvidenceChars,
} from "../config.js";
import { logger } from "../logger.js";
import { callPlaywrightTool } from "../playwright.js";
import { ollama } from "./client.js";
import type { BuiltChatRequest } from "./request.js";

type ChunkHandler = (chunk: { content?: string; thinking?: string }) => void;

// Detect whether a browser tool call produced enough evidence to answer the user directly.
function containsRequestedInformation(
  toolName: string,
  result: { ok: boolean; text: string },
) {
  return (
    result.ok &&
    result.text.trim().length >= minEvidenceChars &&
    ["browser_snapshot", "browser_evaluate", "browser_run_code"].includes(
      toolName,
    )
  );
}

// Run one chat round, streaming chunks to the caller when requested. Content,
// thinking, and tool calls are accumulated so the result looks like a normal
// non-streamed response.
async function runChatRound(
  request: BuiltChatRequest,
  messages: Message[],
  tools: BuiltChatRequest["tools"] | undefined,
  onChunk?: ChunkHandler,
): Promise<ChatResponse> {
  const base = {
    model: request.model,
    messages,
    think: request.think,
    keep_alive: keepAlive,
    options: { num_ctx: request.contextWindow },
    ...(tools?.length ? { tools } : {}),
  };

  if (!request.stream || !onChunk) {
    return ollama.chat({ ...base, stream: false });
  }

  const stream = await ollama.chat({ ...base, stream: true });
  let content = "";
  let thinking = "";
  const toolCalls: ToolCall[] = [];
  let finalChunk: ChatResponse | undefined;

  for await (const chunk of stream) {
    finalChunk = chunk;
    const nextContent = chunk.message.content ?? "";
    const nextThinking = chunk.message.thinking ?? "";
    content += nextContent;
    thinking += nextThinking;
    if (chunk.message.tool_calls?.length) {
      toolCalls.push(...chunk.message.tool_calls);
    }
    if (nextContent || nextThinking) {
      onChunk({ content: nextContent, thinking: nextThinking });
    }
  }

  if (!finalChunk) {
    throw new Error("Ollama returned an empty response.");
  }
  return {
    ...finalChunk,
    message: {
      ...finalChunk.message,
      content,
      thinking,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    },
  };
}

// Run the model with optional browser tools until it either answers or stops using tools.
// Every round, including the final answer, streams through onChunk when streaming is on.
export async function chatWithTools(
  request: BuiltChatRequest,
  onChunk?: ChunkHandler,
): Promise<ChatResponse> {
  const messages: Message[] = [...request.messages];
  let response = await runChatRound(request, messages, request.tools, onChunk);

  for (let round = 0; round < maxToolRounds; round += 1) {
    const toolCalls = response.message.tool_calls ?? [];
    if (toolCalls.length === 0) return response;

    messages.push(response.message);
    for (const toolCall of toolCalls) {
      logger.info({ event: "ai.tool_call" });
      const result = await callPlaywrightTool(
        toolCall.function.name,
        toolCall.function.arguments,
      );
      messages.push({
        role: "tool",
        tool_name: toolCall.function.name,
        content: result.ok
          ? result.text.slice(0, maxToolResultChars)
          : `The tool did not return usable information. ${result.text.slice(0, maxToolErrorChars)}`,
      });

      if (containsRequestedInformation(toolCall.function.name, result)) {
        // Enough evidence gathered: answer now with tools disabled.
        return runChatRound(request, messages, undefined, onChunk);
      }
    }

    response = await runChatRound(request, messages, request.tools, onChunk);
  }

  return response;
}
