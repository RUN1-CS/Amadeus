import pino from "pino";

const sensitiveFields = [
  "password",
  "*.password",
  "token",
  "*.token",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "set-cookie",
  "*.set-cookie",
  "prompt",
  "*.prompt",
  "content",
  "*.content",
  "arguments",
  "*.arguments",
  "result",
  "*.result",
  "text",
  "*.text",
  "email",
  "*.email",
  "username",
  "*.username",
  "aboutMe",
  "*.aboutMe",
  "customBehavior",
  "*.customBehavior",
  "attachments",
  "*.attachments",
  "data",
  "*.data",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: { paths: sensitiveFields, censor: "[REDACTED]" },
});

const knownErrorTypes = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "URIError",
  "ReferenceError",
  "AggregateError",
]);

export function getErrorType(error: unknown) {
  if (!(error instanceof Error)) return "UnknownError";
  return knownErrorTypes.has(error.name) ? error.name : "Error";
}
