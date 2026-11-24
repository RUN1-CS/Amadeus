import { ref, watch, type Ref } from "vue";

import i18n from "@/i18n";
import { useOllamaStore } from "@/stores/ollama";
import type { AttachmentItem, ChatMessage } from "@/types/chat";

type AttachmentFile = File | AttachmentItem;

export function getFileKey(file: AttachmentFile): string {
  if ("lastModified" in file && file.lastModified !== undefined) {
    return `${file.name}:${file.lastModified}`;
  }
  if ("url" in file && file.url) return `${file.name}:${file.url}`;
  if ("content" in file && file.content) return `${file.name}:${file.content.length}`;
  return file.name;
}

export function isPdfFile(file: Pick<File, "name" | "type">): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function useChatAttachments(messageList: Ref<ChatMessage[]>) {
  const store = useOllamaStore();
  const attachmentInput = ref<HTMLInputElement | null>(null);
  const attachments = ref<File[]>([]);
  const isDraggingFiles = ref(false);
  const attachmentContents = ref<Record<string, string>>({});
  const loadedAttachmentUrls = ref<Record<string, string>>({});
  const expandedAttachments = ref<Record<string, boolean>>({});
  const hiddenAttachments = ref<Record<string, boolean>>({});
  const loadedContents = ref<Record<string, string>>({});
  let dragDepth = 0;

  async function loadImageIfNeeded(file: AttachmentItem) {
    if (file.kind !== "image" || !file.url || !file.url.startsWith("/")) return;
    const key = getFileKey(file);
    if (loadedAttachmentUrls.value[key]) return;

    try {
      const response = await fetch(`http://${window.location.hostname}:8080${file.url}`, {
        headers: { Authorization: `Bearer ${store.token}` },
      });
      if (!response.ok) throw new Error(`Failed to fetch generated image: ${response.statusText}`);
      loadedAttachmentUrls.value[key] = URL.createObjectURL(await response.blob());
    } catch (error) {
      console.error("Failed to fetch generated image:", error);
    }
  }

  async function addAttachments(files: File[]) {
    if (!files.length) return;

    for (const file of files) {
      const key = getFileKey(file);
      if (file.type.startsWith("image/") || isPdfFile(file)) {
        loadedAttachmentUrls.value[key] = URL.createObjectURL(file);
      } else {
        attachmentContents.value[key] = await file.text();
      }
      expandedAttachments.value[key] = false;
      hiddenAttachments.value[key] = false;
    }

    attachments.value.push(...files);
  }

  function handleFileSelection(event: Event) {
    const input = event.target as HTMLInputElement;
    void addAttachments(Array.from(input.files ?? []));
    input.value = "";
  }

  function containsFiles(event: DragEvent) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  function handleFileDragEnter(event: DragEvent) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    isDraggingFiles.value = true;
  }

  function handleFileDragOver(event: DragEvent) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function handleFileDragLeave(event: DragEvent) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    isDraggingFiles.value = dragDepth > 0;
  }

  function handleFileDrop(event: DragEvent) {
    if (!containsFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    isDraggingFiles.value = false;
    void addAttachments(Array.from(event.dataTransfer?.files ?? []));
  }

  function removeAttachment(index: number) {
    const file = attachments.value[index];
    if (file) {
      const key = getFileKey(file);
      delete attachmentContents.value[key];
      delete expandedAttachments.value[key];
      delete hiddenAttachments.value[key];
    }
    attachments.value.splice(index, 1);
  }

  function getAttachmentFileList(): FileList {
    const transfer = new DataTransfer();
    attachments.value.forEach((file) => transfer.items.add(file));
    return transfer.files;
  }

  function getDisplayContent(file: AttachmentFile): string {
    const key = getFileKey(file);
    if ("content" in file && file.content) return file.content;
    if (attachmentContents.value[key]) return attachmentContents.value[key];
    if (loadedContents.value[key]) return loadedContents.value[key];
    return "";
  }

  function getPreviewText(file: AttachmentFile): string {
    const text = getDisplayContent(file);
    if (!text) return i18n.global.t("attachments.loading");
    const lines = text.split("\n").slice(0, 3).join("\n");
    const maxChars = 160;
    if (lines.length > maxChars) return `${lines.slice(0, maxChars).trim()}…`;
    if (text.length > lines.length) return `${lines.trim()}…`;
    return lines;
  }

  async function loadFileContentIfNeeded(file: AttachmentItem) {
    const key = getFileKey(file);
    if (attachmentContents.value[key] || loadedContents.value[key] !== undefined || !file.url) {
      return;
    }

    try {
      const response = await fetch(file.url, {
        headers: { Authorization: `Bearer ${store.token}` },
      });
      if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
      loadedContents.value[key] = await response.text();
    } catch (error) {
      console.error("Failed to fetch file content:", error);
      loadedContents.value[key] = i18n.global.t("attachments.failed");
    }
  }

  function toggleExpand(file: AttachmentFile) {
    const key = getFileKey(file);
    expandedAttachments.value[key] = !expandedAttachments.value[key];
  }

  function toggleHideAttachment(file: AttachmentFile) {
    const key = getFileKey(file);
    hiddenAttachments.value[key] = !hiddenAttachments.value[key];
  }

  watch(
    messageList,
    (messages) => {
      for (const message of messages) {
        for (const file of message.attachments ?? []) {
          void loadFileContentIfNeeded(file);
          void loadImageIfNeeded(file);
        }
      }
    },
    { immediate: true, deep: true },
  );

  return {
    attachmentInput,
    attachments,
    isDraggingFiles,
    attachmentContents,
    loadedAttachmentUrls,
    expandedAttachments,
    hiddenAttachments,
    addAttachments,
    containsFiles,
    getAttachmentFileList,
    getDisplayContent,
    getPreviewText,
    handleFileSelection,
    handleFileDragEnter,
    handleFileDragOver,
    handleFileDragLeave,
    handleFileDrop,
    removeAttachment,
    toggleExpand,
    toggleHideAttachment,
  };
}
