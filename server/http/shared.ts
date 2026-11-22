import type { IncomingMessage, ServerResponse } from "node:http";
import { getCachedUserBySession } from "../sessions.js";
import { HttpError } from "../classes/httpError.js";
import { databaseBackupMaxUploadBytes } from "../config.js";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const allowedOrigin = process.env.CORS_ORIGIN ?? "*";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition",
  "Access-Control-Max-Age": "86400",
  ...(allowedOrigin === "*" ? {} : { Vary: "Origin" }),
};

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders,
  });
  response.end(JSON.stringify(body));
}

export function sendNoContent(response: ServerResponse) {
  response.writeHead(204, corsHeaders);
  response.end();
}

const maxJsonBytes = 1024 * 1024;

export async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxJsonBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as Record<string, unknown>;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export async function requireUser(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const user = await getCachedUserBySession(token);
  if (!user) sendJson(response, 401, { error: "Authentication required." });
  return user;
}

export async function receiveBackupUpload(
  request: IncomingMessage,
  filePath: string,
) {
  const contentLength = Number(request.headers["content-length"]);
  if (
    Number.isFinite(contentLength) &&
    contentLength > databaseBackupMaxUploadBytes
  ) {
    request.resume();
    throw new HttpError(
      413,
      "Backup file exceeds the configured upload limit.",
    );
  }

  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > databaseBackupMaxUploadBytes) {
        callback(
          new HttpError(
            413,
            "Backup file exceeds the configured upload limit.",
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(request, limit, createWriteStream(filePath, { flags: "w" }));
  if (size === 0) throw new HttpError(400, "Backup file is empty.");
}

export function getOllamaModelNames(models: unknown[]) {
  return models.flatMap((model) =>
    typeof model === "object" &&
    model !== null &&
    "name" in model &&
    typeof model.name === "string"
      ? [model.name]
      : [],
  );
}

export function isSafeSubfolder(subfolder: string) {
  if (!subfolder) return true;
  return (
    /^[\w .-]+(\/[\w .-]+)*$/.test(subfolder) &&
    !subfolder.split("/").includes("..")
  );
}
