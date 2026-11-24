// Token budgeting: trims chat history so prompts fit the model's context window.
import type { Message } from "ollama";

import { reservedOutputTokens, tokensPerImage } from "../config.js";
import type { SavedMessage } from "../types.js";

// Roughly estimate token usage so prompts fit inside the model window.
export function estimateTokens(content: string) {
  return Math.ceil(content.length / 4);
}

// Trim older history to fit the model's remaining context budget. Keeps the
// newest contiguous run of messages so the conversation never has gaps, and
// always puts the system prompt first and the new user prompt last.
export function fitMessages(
  history: SavedMessage[],
  systemPrompt: string,
  prompt: string,
  contextWindow: number,
  images: string[] = [],
): Message[] {
  const budget = Math.max(256, contextWindow - reservedOutputTokens);
  let tokenCount =
    estimateTokens(systemPrompt) +
    estimateTokens(prompt) +
    images.length * tokensPerImage;

  const kept: Message[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) continue;
    const messageTokens = estimateTokens(message.content);
    if (tokenCount + messageTokens > budget) break;
    kept.push({ role: message.role, content: message.content });
    tokenCount += messageTokens;
  }
  kept.reverse();

  return [
    { role: "system", content: systemPrompt },
    ...kept,
    { role: "user", content: prompt, images },
  ];
}
