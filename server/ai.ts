import { Ollama } from "ollama";

import {
  configuredContextWindow,
  ollamaBaseUrl,
  reservedOutputTokens,
} from "./config.js";
import { getErrorMessage } from "./errors.js";
import type { SavedMessage } from "./db.js";
import type { ClientMessage } from "./protocol.js";
import { searchWikipedia } from "./wiki_search.js";

export const ollama = new Ollama({ host: ollamaBaseUrl });

type OllamaModels = unknown[];

let cachedModels: OllamaModels = [];
let modelLoadError: string | undefined;
const modelContextWindows = new Map<string, number>();

export async function loadModels(): Promise<OllamaModels> {
  try {
    const response = await ollama.list();
    cachedModels = response.models;
    modelLoadError = undefined;
  } catch (error) {
    modelLoadError = getErrorMessage(error);
    console.error("Could not load Ollama models:", error);
  }
  return cachedModels;
}

export function getModels() {
  return { models: cachedModels, error: modelLoadError };
}

async function getModelContextWindow(model: string) {
  const cached = modelContextWindows.get(model);
  if (cached) return cached;

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
  modelContextWindows.set(model, contextWindow);
  return contextWindow;
}

function estimateTokens(content: string) {
  return Math.ceil(content.length / 4);
}

function fitMessages(
  history: SavedMessage[],
  systemPrompt: string,
  prompt: string,
  contextWindow: number,
) {
  const budget = Math.max(256, contextWindow - reservedOutputTokens);
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [{ role: "system", content: systemPrompt }];
  let tokenCount = estimateTokens(systemPrompt) + estimateTokens(prompt);

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) continue;
    const messageTokens = estimateTokens(message.content);
    if (tokenCount + messageTokens > budget) continue;
    messages.unshift({ role: message.role, content: message.content });
    tokenCount += messageTokens;
  }

  return [...messages, { role: "user", content: prompt }];
}

export async function buildChatRequest(
  userName: string,
  aboutMe: string,
  customBehavior: string,
  data: ClientMessage,
  history: SavedMessage[],
) {
  const model = data.model ?? "";
  let prompt = data.prompt ?? "";
  if (data.tsundere) {
    prompt +=
      "\n\nYou are a tsundere. You will respond in a tsundere manner, being cold and aloof, but secretly caring and affectionate.";
  }

  const wikipediaContext = data.wikiSearch ? await searchWikipedia(prompt) : "";
  const contextWindow = await getModelContextWindow(model);
  const systemPrompt = [
    "You are the AI assistant. The person sending the user messages is the human user. Never claim to be the user or speak as if you are the user.",
    `The human user's username is ${userName}. Address the human user by name when it is natural and useful.`,
    aboutMe.trim()
      ? `About the human user (not about you):\nThe statements below describe the human user. If they use first-person language such as "I am" or "I like", interpret it as referring to the human user. Do not adopt these traits, opinions, or preferences as your own.\n${aboutMe.trim()}`
      : "",
    customBehavior.trim()
      ? `The human user's preferences for your behavior:\n${customBehavior.trim()}`
      : "",
    wikipediaContext
      ? `Relevant Wikipedia context for the current request. Treat it as reference material, verify uncertainty, and cite the provided source links when useful:\n${wikipediaContext}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    model,
    messages: fitMessages(history, systemPrompt, prompt, contextWindow),
    think: data.thinking ?? false,
    contextWindow,
  };
}

export async function generateChatTitle(
  model: string,
  prompt: string,
  response: string,
  contextWindow: number,
) {
  const titleResponse = await ollama.chat({
    model,
    messages: [
      {
        role: "system",
        content:
          "Create a concise title for this conversation. Use 3 to 6 words, no quotation marks, markdown, or punctuation at the end. Return only the title.",
      },
      {
        role: "user",
        content: `User's first message:\n${prompt.slice(0, 2000)}\n\nAssistant's response:\n${response.slice(0, 2000)}`,
      },
    ],
    think: false,
    stream: false,
    options: { num_ctx: contextWindow },
  });
  return (titleResponse.message.content ?? "")
    .replace(/["'`*_#]/g, "")
    .replace(/[.!?]+$/, "")
    .trim()
    .slice(0, 100);
}
