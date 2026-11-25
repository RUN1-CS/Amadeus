import type { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { rm } from "node:fs/promises";
import {
  getAdminOverview,
  getAdminUsers,
  getServerLogs,
  isAdmin,
  getAiModelAccess,
  setAiModelEnabled,
  reconcileUsersAfterRestore,
} from "../db.js";
import { getComfyModels, loadComfyModels } from "../comfyui.js";
import { getModels, loadModels } from "../ai.js";
import {
  createDatabaseBackup,
  createRestoreUploadPath,
  restoreDatabaseBackup,
  streamBackup,
} from "../backups.js";
import {
  databaseBackupMaxUploadBytes,
  databaseBackupsEnabled,
} from "../config.js";
import { clearUserCache } from "../sessions.js";
import {
  readJson,
  receiveBackupUpload,
  sendError,
  sendJson,
  corsHeaders,
  getOllamaModelNames,
} from "./shared.js";
import type { PublicUser } from "../types.js";

async function requireAdmin(userId: number, response: ServerResponse) {
  if (await isAdmin(userId)) return true;
  sendError(
    response,
    403,
    "ADMINISTRATOR_REQUIRED",
    "Administrator access is required.",
  );
  return false;
}

export async function handleAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  user: PublicUser,
): Promise<boolean> {
  const { pathname: path } = url;

  if (path === "/api/admin/backups" && request.method === "GET") {
    if (!(await requireAdmin(user.id, response))) return true;
    sendJson(response, 200, {
      enabled: databaseBackupsEnabled,
      maxUploadBytes: databaseBackupMaxUploadBytes,
    });
    return true;
  }

  if (path === "/api/admin/backups" && request.method === "POST") {
    if (!(await requireAdmin(user.id, response))) return true;
    if (!databaseBackupsEnabled) {
      sendError(response, 503, "BACKUPS_DISABLED", "Database backups are disabled.");
      return true;
    }

    const backup = await createDatabaseBackup();
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${backup.filename}"`,
      "Content-Length": backup.size,
      "Cache-Control": "no-store",
      ...corsHeaders,
    });
    await pipeline(await streamBackup(backup.filePath), response);
    return true;
  }

  if (path === "/api/admin/backups/restore" && request.method === "POST") {
    if (!(await requireAdmin(user.id, response))) return true;
    if (!databaseBackupsEnabled) {
      sendError(response, 503, "BACKUPS_DISABLED", "Database backups are disabled.");
      return true;
    }
    if (
      !request.headers["content-type"]?.startsWith("application/octet-stream")
    ) {
      sendError(
        response,
        415,
        "INVALID_BACKUP_CONTENT_TYPE",
        "Upload the backup as application/octet-stream.",
      );
      return true;
    }

    const filePath = await createRestoreUploadPath();
    try {
      await receiveBackupUpload(request, filePath);
      await restoreDatabaseBackup(filePath);
      await reconcileUsersAfterRestore();
      clearUserCache();
    } finally {
      await rm(filePath, { force: true });
    }
    sendJson(response, 200, { restored: true });
    return true;
  }

  if (path === "/api/admin/overview" && request.method === "GET") {
    if (!(await requireAdmin(user.id, response))) return true;
    const [overview, ollamaModels] = await Promise.all([
      getAdminOverview(),
      getModels(),
    ]);
    const comfyModels = getComfyModels();
    const ollamaNames = getOllamaModelNames(ollamaModels.models);
    sendJson(response, 200, {
      ...overview,
      services: {
        ollama: {
          status: ollamaModels.error
            ? ollamaNames.length
              ? "degraded"
              : "unavailable"
            : ollamaNames.length
              ? "available"
              : "unavailable",
          models: ollamaNames,
          error: ollamaModels.error,
          errorLocalizationCode: ollamaModels.error
            ? "AI_SERVICE_ERROR"
            : undefined,
          errorLocalizationParams: ollamaModels.error
            ? { details: ollamaModels.error }
            : undefined,
        },
        comfyui: {
          status: comfyModels.error
            ? comfyModels.models.length
              ? "degraded"
              : "unavailable"
            : comfyModels.models.length
              ? "available"
              : "unavailable",
          models: comfyModels.models,
          error: comfyModels.error,
          errorLocalizationCode: comfyModels.error
            ? "AI_SERVICE_ERROR"
            : undefined,
          errorLocalizationParams: comfyModels.error
            ? { details: comfyModels.error }
            : undefined,
        },
      },
    });
    return true;
  }

  if (path === "/api/admin/users" && request.method === "GET") {
    if (!(await requireAdmin(user.id, response))) return true;
    const beforeId = url.searchParams.get("beforeId") ?? undefined;
    if (beforeId !== undefined && !/^[1-9]\d*$/.test(beforeId)) {
      sendError(response, 400, "INVALID_USER_CURSOR", "Invalid user pagination cursor.");
      return true;
    }
    sendJson(response, 200, await getAdminUsers(beforeId));
    return true;
  }

  if (path === "/api/admin/logs" && request.method === "GET") {
    if (!(await requireAdmin(user.id, response))) return true;
    const level = url.searchParams.get("level") ?? undefined;
    const event = url.searchParams.get("event")?.trim() || undefined;
    const beforeId = url.searchParams.get("beforeId") ?? undefined;
    const levels = ["trace", "debug", "info", "warn", "error", "fatal"];
    if (level && !levels.includes(level)) {
      sendError(response, 400, "INVALID_LOG_LEVEL", "Invalid log level filter.");
      return true;
    }
    if (event && event.length > 120) {
      sendError(response, 400, "LOG_EVENT_TOO_LONG", "Log event filter is too long.");
      return true;
    }
    if (beforeId !== undefined && !/^[1-9]\d*$/.test(beforeId)) {
      sendError(response, 400, "INVALID_LOG_CURSOR", "Invalid log pagination cursor.");
      return true;
    }
    sendJson(response, 200, await getServerLogs({ level, event, beforeId }));
    return true;
  }

  if (path === "/api/admin/models" && request.method === "GET") {
    if (!(await requireAdmin(user.id, response))) return true;
    const [ollamaModels, comfyModelNames] = await Promise.all([
      loadModels(),
      loadComfyModels(),
    ]);
    const ollamaNames = getOllamaModelNames(ollamaModels);
    sendJson(response, 200, {
      ollama: await getAiModelAccess("ollama", ollamaNames),
      comfyui: await getAiModelAccess("comfyui", comfyModelNames),
      errors: {
        ollama: getModels().error,
        comfyui: getComfyModels().error,
      },
      errorLocalizationCodes: {
        ollama: getModels().error ? "AI_SERVICE_ERROR" : undefined,
        comfyui: getComfyModels().error ? "AI_SERVICE_ERROR" : undefined,
      },
      errorLocalizationParams: {
        ollama: getModels().error
          ? { details: getModels().error }
          : undefined,
        comfyui: getComfyModels().error
          ? { details: getComfyModels().error }
          : undefined,
      },
    });
    return true;
  }

  if (path === "/api/admin/models" && request.method === "PATCH") {
    if (!(await requireAdmin(user.id, response))) return true;
    const body = await readJson(request);
    const modelType = body.modelType;
    const modelName =
      typeof body.modelName === "string" ? body.modelName.trim() : "";
    if (
      (modelType !== "ollama" && modelType !== "comfyui") ||
      !modelName ||
      typeof body.enabled !== "boolean"
    ) {
      sendError(
        response,
        400,
        "INVALID_MODEL_ACCESS",
        "Provide a valid model type, model name, and enabled state.",
      );
      return true;
    }
    const availableModels =
      modelType === "ollama"
        ? getOllamaModelNames(getModels().models)
        : getComfyModels().models;
    if (!availableModels.includes(modelName)) {
      sendError(response, 404, "AI_MODEL_NOT_FOUND", "AI model not found.");
      return true;
    }
    await setAiModelEnabled(modelType, modelName, body.enabled);
    sendJson(response, 200, { modelType, modelName, enabled: body.enabled });
    return true;
  }

  return false;
}
