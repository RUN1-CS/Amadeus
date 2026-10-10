export const port = Number(process.env.PORT ?? 8080);
export const ollamaBaseUrl =
  process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
export const configuredContextWindow = Math.max(
  512,
  Number(process.env.OLLAMA_NUM_CTX ?? 4096),
);
export const reservedOutputTokens = 1024;
