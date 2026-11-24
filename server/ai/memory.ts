// Recalls remembered user messages that are relevant to the current prompt.
import { maxMemoryContextLength, maxMemoryResults } from "../config.js";
import { searchSimilarMessages } from "../db.js";
import { getErrorType, logger } from "../logger.js";
import { embedText } from "./embeddings.js";

// Pull the most relevant remembered user messages into the prompt context.
export async function searchMessageMemory(userId: number, prompt: string) {
  const embedding = await embedText(prompt);
  if (!embedding) return { context: "", embedding };
  try {
    const memories = await searchSimilarMessages(
      userId,
      embedding,
      maxMemoryResults,
    );
    const context = memories
      .filter((memory) => memory.similarity >= 0.35)
      .map((memory) => `[${memory.role}] ${memory.content.slice(0, 1_500)}`)
      .join("\n")
      .slice(0, maxMemoryContextLength);
    return { context, embedding };
  } catch (error) {
    logger.warn(
      { event: "ai.memory_search_failed", errorType: getErrorType(error) },
      "Could not search message memory",
    );
    return { context: "", embedding };
  }
}
