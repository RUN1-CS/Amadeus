// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Turning saved server messages into UI messages, plus the file-block format
// that uploads are written in and parsed back out of.
import type { ChatMessage, SavedMessage } from "@/types/chat";

const FILE_BLOCK = /(?:^|\n\n)File: ([^\n]+)\n```\n([\s\S]*?)\n```(?=\n\nFile: |$)/g;

// Created once: building a formatter per message is slow for long chats.
const timeFormat = new Intl.DateTimeFormat([], {
  hour: "numeric",
  minute: "2-digit",
});

// Writer side of FILE_BLOCK: how an uploaded text file is embedded in a prompt.
export function formatFileBlock(name: string, content: string) {
  return `File: ${name}\n\`\`\`\n${content}\n\`\`\``;
}

// Reader side of FILE_BLOCK: pull embedded files back out of a saved user message.
export function splitSavedContent(raw: string) {
  const files: { name: string; content: string }[] = [];
  const text = raw
    .replace(FILE_BLOCK, (_match, name: string, content: string) => {
      files.push({ name, content });
      return "";
    })
    .trim();
  return { text, files };
}

export function mapSavedMessages(messages: SavedMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const raw = message.content ?? "";
    const parsed = message.role === "user" ? splitSavedContent(raw) : null;
    const saved = message.attachments ?? [];
    const extracted = (parsed?.files ?? []).map((file) => ({
      ...saved.find((s) => s.name === file.name),
      ...file,
    }));

    return {
      id: message.id,
      role: message.role,
      content: parsed ? parsed.text : raw,
      model: message.model,
      time: timeFormat.format(new Date(message.createdAt)),
      attachments: extracted.length ? extracted : saved,
    };
  });
}
