import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { getAiModelAccess, isAdmin } from "../db.js";
import { getComfyImage, getComfyModels, loadComfyModels } from "../comfyui.js";
import type { PublicUser } from "../types.js";
import { isSafeSubfolder, sendJson } from "./shared.js";

export async function handleComfyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  user: PublicUser,
): Promise<boolean> {
  if (url.pathname === "/api/comfy/models" && request.method === "GET") {
    if (getComfyModels().models.length === 0) await loadComfyModels();
    const result = getComfyModels();
    const models = await getAiModelAccess("comfyui", result.models);
    sendJson(response, 200, {
      ...result,
      models: (await isAdmin(user.id))
        ? result.models
        : models.filter((model) => model.enabled).map((model) => model.name),
    });
    return true;
  }

  if (url.pathname === "/api/comfy/image" && request.method === "GET") {
    const filename = url.searchParams.get("filename") ?? "";
    const subfolder = url.searchParams.get("subfolder") ?? "";
    const type = url.searchParams.get("type") ?? "output";
    if (
      !filename ||
      filename === ".." ||
      /[/\\]/.test(filename) ||
      !isSafeSubfolder(subfolder) ||
      !["output", "input", "temp"].includes(type)
    ) {
      sendJson(response, 400, { error: "Invalid ComfyUI image reference." });
      return true;
    }
    const upstream = await getComfyImage({ filename, subfolder, type });
    if (!upstream.ok || !upstream.body) {
      sendJson(response, upstream.status === 404 ? 404 : 502, {
        error: "Image not available.",
      });
      return true;
    }
    const allowedOrigin = process.env.CORS_ORIGIN ?? "*";
    response.writeHead(200, {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      "Cache-Control":
        type === "output"
          ? "private, max-age=31536000, immutable"
          : "private, max-age=3600",
      "Access-Control-Allow-Origin": allowedOrigin,
    });
    await pipeline(
      Readable.fromWeb(upstream.body as unknown as WebReadableStream),
      response,
    );
    return true;
  }
  return false;
}
