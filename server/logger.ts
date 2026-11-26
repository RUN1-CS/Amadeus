// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

import { Writable } from "node:stream";

import pino from "pino";

import type { PersistedLog } from "./types.js";

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

type LogWriter = (entry: PersistedLog) => Promise<void>;

const levels: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

const allowedMetadata = [
  "method",
  "statusCode",
  "durationMs",
  "code",
  "errorType",
  "toolSupport",
  "usingDefaults",
  "ok",
  "port",
  "migration",
];

let writeLog: LogWriter | undefined;
let lastPersistenceWarningAt = 0;

function reportPersistenceFailure() {
  const now = Date.now();
  if (now - lastPersistenceWarningAt < 60_000) return;
  lastPersistenceWarningAt = now;
  process.stderr.write(
    '{"level":"error","event":"database.log_persistence_failed"}\n',
  );
}

function toPersistedLog(value: unknown): PersistedLog | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const event =
    typeof record.event === "string" &&
    /^[a-z0-9_.-]{1,120}$/.test(record.event)
      ? record.event
      : undefined;
  const level =
    typeof record.level === "number" ? levels[record.level] : undefined;
  if (!event || !level) return undefined;

  const timestamp =
    typeof record.time === "number" ? new Date(record.time) : new Date();
  const loggedAt = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
  const metadata: PersistedLog["metadata"] = {};
  for (const key of allowedMetadata) {
    const field = record[key];
    if (
      typeof field === "string" ||
      typeof field === "number" ||
      typeof field === "boolean"
    ) {
      metadata[key] = field;
    }
  }
  return { loggedAt, level, event, metadata };
}

const databaseLogStream = new Writable({
  write(chunk, _encoding, callback) {
    if (!writeLog) {
      callback();
      return;
    }

    let entry: PersistedLog | undefined;
    try {
      entry = toPersistedLog(JSON.parse(chunk.toString()));
    } catch {
      reportPersistenceFailure();
      callback();
      return;
    }

    if (!entry) {
      callback();
      return;
    }

    const writer = writeLog;
    void Promise.resolve()
      .then(() => writer(entry))
      .then(
        () => callback(),
        () => {
          reportPersistenceFailure();
          callback();
        },
      );
  },
});

export function setDatabaseLogWriter(writer: LogWriter) {
  writeLog = writer;
}

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: sensitiveFields, censor: "[REDACTED]" },
  },
  pino.multistream([
    { level: "trace", stream: process.stdout },
    { level: "trace", stream: databaseLogStream },
  ]),
);

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
