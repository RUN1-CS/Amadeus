// Server
export const port = Number(process.env.PORT ?? 8080);
export const heartbeatMs = Number(process.env.HEARTBEAT_MS ?? 30_000);

// Ollama
export const ollamaBaseUrl =
  process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
export const configuredContextWindow = Math.max(
  512,
  Number(process.env.OLLAMA_NUM_CTX ?? 4096),
);
export const embeddingModel =
  process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text";
export const reservedOutputTokens = 1024;
export const keepAlive = process.env.KEEPT_ALIVE ?? "30m";

// ComfyUI
export const comfyUiBaseUrl =
  process.env.COMFYUI_BASE_URL ?? "http://comfyui:8188";
export const comfyUiNegativePrompt =
  process.env.COMFYUI_DEFAULT_NEGATIVE_PROMPT ?? "";
export const tokensPerImage = Number(process.env.TOKENS_PER_IMAGE ?? 600);

// Memory
export const maxMemoryResults = Number(process.env.MAX_MEMORY_RESULTS ?? 6);
export const maxMemoryContextLength = Number(
  process.env.MAX_MEMORY_CONTEXT_LENGTH ?? 6_000,
);

// Tools
export const maxToolRounds = Number(process.env.MAX_TOOL_ROUNDS ?? 8);
export const maxToolResultChars = Number(
  process.env.MAX_TOOL_RESULT_CHARS ?? 12_000,
);
export const maxToolErrorChars = Number(
  process.env.MAX_TOOL_ERROR_CHARS ?? 500,
);
export const minEvidenceChars = Number(process.env.MIN_EVIDENCE_CHARS ?? 400);

// Cache
export const ttlMs = Number(process.env.TTL_MS ?? 30_000);
export const maxEntries = Number(process.env.MAX_ENTRIES ?? 1_000);

// Transport
// Images arrive base64-encoded over this socket, so allow room for them but not the 100 MiB default.
export const maxPayloadBytes = Number(
  process.env.MAX_PAYLOAD_BYTES ?? 25 * 1024 * 1024,
);

// Logging
export const logRetentionMs = Number(
  process.env.LOG_RETENTION_MS ?? 30 * 24 * 60 * 60 * 1000,
);
export const logCleanupIntervalMs = Number(
  process.env.LOG_CLEANUP_INTERVAL_MS ?? 86400000,
);
