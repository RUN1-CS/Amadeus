// Generates short conversation titles.
import { keepAlive } from "../config.js";
import { ollama } from "./client.js";

// Condense the first exchange into a short, readable conversation title.
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
    keep_alive: keepAlive,
    options: { num_ctx: contextWindow },
  });
  return (titleResponse.message.content ?? "")
    .replace(/["'`*_#]/g, "")
    .replace(/[.!?]+$/, "")
    .trim()
    .slice(0, 100);
}
