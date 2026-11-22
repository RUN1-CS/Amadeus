import Busboy from "busboy";
import { PDFParse } from "pdf-parse";
import { type IncomingMessage } from "node:http";
import {
  maxUploadBytes,
  maxUploadFiles,
  maxExtractedTextChars,
} from "../config.js";

import type { UploadedFile } from "../types.js";
import { HttpError } from "../classes/httpError.js";

function truncateText(text: string, notice: string) {
  if (text.length <= maxExtractedTextChars) return text;
  return `${text.slice(0, maxExtractedTextChars)}\n${notice}`;
}

async function extractPdfText(data: Buffer) {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (!text) return "[No extractable text found in this PDF.]";
    return truncateText(text, "[PDF text truncated.]");
  } finally {
    await parser.destroy();
  }
}

// Binary files decoded as UTF-8 are just noise in a prompt; NUL bytes are a cheap tell.
function looksBinary(bytes: Buffer) {
  return bytes.subarray(0, 8_192).includes(0);
}

// Turn one uploaded part into the shape the client expects.
async function toUploadedFile(
  name: string,
  mimeType: string,
  bytes: Buffer,
): Promise<UploadedFile> {
  if (mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    return { name, kind: "pdf", content: await extractPdfText(bytes) };
  }
  if (mimeType.startsWith("image/")) {
    return { name, kind: "image", data: bytes.toString("base64") };
  }
  if (looksBinary(bytes)) {
    throw new HttpError(
      415,
      `${name} looks like a binary file and can't be read as text.`,
    );
  }
  return {
    name,
    kind: "file",
    content: truncateText(bytes.toString("utf8"), "[File text truncated.]"),
  };
}

// Stream uploaded files out of the multipart form without storing them on disk.
// PDF extraction for several files runs in parallel once the upload finishes.
export function readMultipartFiles(request: IncomingMessage) {
  return new Promise<UploadedFile[]>((resolve, reject) => {
    let busboy: ReturnType<typeof Busboy>;
    try {
      busboy = Busboy({
        headers: request.headers,
        defParamCharset: "utf8",
        limits: { fileSize: maxUploadBytes, files: maxUploadFiles },
      });
    } catch {
      reject(new HttpError(400, "Invalid multipart upload."));
      return;
    }

    const pending: Promise<UploadedFile>[] = [];
    let failed = false;
    const fail = (error: unknown) => {
      if (failed) return;
      failed = true;
      request.unpipe(busboy);
      request.resume();
      reject(error);
    };

    busboy.on("file", (_field, stream, info) => {
      const { filename, mimeType } = info;
      if (!filename) {
        stream.resume();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () =>
        fail(new HttpError(413, "Uploads must be smaller than 10 MB.")),
      );
      stream.on("end", () => {
        if (failed) return;
        const task = toUploadedFile(
          filename,
          mimeType.toLowerCase(),
          Buffer.concat(chunks),
        );
        task.catch(() => {}); // avoid an unhandled rejection; Promise.all below reports it
        pending.push(task);
      });
    });
    busboy.on("filesLimit", () =>
      fail(
        new HttpError(413, `Upload at most ${maxUploadFiles} files at once.`),
      ),
    );
    busboy.on("error", fail);
    busboy.on("close", () => {
      if (failed) return;
      Promise.all(pending).then(resolve, reject);
    });

    request.pipe(busboy);
  });
}
