// File uploads: send files to the server, and build the local attachment previews.
import type { createApiClient } from "@/services/api";
import type { ChatMessage } from "@/types/chat";

import { formatFileBlock } from "./messages";

export type ApiClient = ReturnType<typeof createApiClient>;

export type UploadKind = "image" | "pdf" | "file";
export type UploadResult = {
  content: string;
  images: string[];
  attachments: { name: string; kind: UploadKind }[];
};

// Upload document and image files to the server for model ingestion.
export async function uploadFiles(
  api: ApiClient,
  chatId: number,
  files: FileList | null,
): Promise<UploadResult> {
  const result: UploadResult = { content: "", images: [], attachments: [] };
  if (!files?.length) return result;

  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }

  const response = await api.request<{
    files: {
      name: string;
      content?: string;
      kind: UploadKind;
      data?: string;
    }[];
  }>(`/api/chats/${chatId}/upload`, { method: "POST", body: formData });

  const textBlocks: string[] = [];
  for (const file of response.files) {
    result.attachments.push({ name: file.name, kind: file.kind });
    if (file.kind === "image") {
      if (file.data) result.images.push(file.data);
    } else {
      textBlocks.push(formatFileBlock(file.name, file.content ?? ""));
    }
  }
  result.content = textBlocks.join("\n\n");
  return result;
}

// Blob URLs created for outgoing attachments; revoked when the message list is replaced.
export function createObjectUrlTracker() {
  const urls = new Set<string>();
  return {
    create(file: Blob) {
      const url = URL.createObjectURL(file);
      urls.add(url);
      return url;
    },
    revokeAll() {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}

export type ObjectUrlTracker = ReturnType<typeof createObjectUrlTracker>;

// Fallback when the server did not report a kind for an attachment.
function guessKind(file: File): UploadKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  return "file";
}

// Attachments shown on the user's own message right after sending.
export function buildLocalAttachments(
  files: FileList | null,
  uploaded: UploadResult,
  urls: ObjectUrlTracker,
): ChatMessage["attachments"] {
  return Array.from(files ?? []).map((file, index) => ({
    name: file.name,
    url: urls.create(file),
    lastModified: file.lastModified,
    kind: uploaded.attachments[index]?.kind ?? guessKind(file),
  }));
}
