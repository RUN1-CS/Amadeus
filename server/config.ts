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

// Database backups
export const databaseBackupsEnabled =
  process.env.DATABASE_BACKUPS_ENABLED !== "false";
export const databaseBackupDirectory =
  process.env.DATABASE_BACKUP_DIRECTORY ?? "/backups";
export const pgDumpPath = process.env.PG_DUMP_PATH ?? "pg_dump";
export const pgRestorePath = process.env.PG_RESTORE_PATH ?? "pg_restore";
const defaultBackupRetentionDays = 30;
const configuredBackupRetentionDays = Number(
  process.env.DATABASE_BACKUP_RETENTION_DAYS ?? defaultBackupRetentionDays,
);
export const databaseBackupRetentionDays =
  Number.isSafeInteger(configuredBackupRetentionDays) &&
  configuredBackupRetentionDays >= 0
    ? configuredBackupRetentionDays
    : defaultBackupRetentionDays;
const defaultBackupUploadLimit = 1024 * 1024 * 1024;
const configuredBackupUploadLimit = Number(
  process.env.DATABASE_BACKUP_MAX_UPLOAD_BYTES ?? defaultBackupUploadLimit,
);
export const databaseBackupMaxUploadBytes =
  Number.isSafeInteger(configuredBackupUploadLimit) &&
  configuredBackupUploadLimit > 0
    ? configuredBackupUploadLimit
    : defaultBackupUploadLimit;
const defaultBackupTimeoutMs = 30 * 60 * 1000;
const configuredBackupTimeout = Number(
  process.env.DATABASE_BACKUP_TIMEOUT_MS ?? defaultBackupTimeoutMs,
);
export const databaseBackupTimeoutMs =
  Number.isSafeInteger(configuredBackupTimeout) && configuredBackupTimeout > 0
    ? configuredBackupTimeout
    : defaultBackupTimeoutMs;

// User data encryption
export const dataEncryptionKey = process.env.DATA_ENCRYPTION_KEY ?? "";

// Login
export const loginMaxFailures = 10;
export const loginWindowMs = 15 * 60 * 1000;

// Registration
export const registerMaxAttempts = 10;
export const registerWindowMs = 60 * 60 * 1000;

// File uploads
export const maxUploadBytes = 10 * 1024 * 1024;
export const maxUploadFiles = 5;
export const maxExtractedTextChars = 50_000;
