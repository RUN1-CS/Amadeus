// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

export interface MemoryRow {
  id: number;
  user_id: number;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  embedding?: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMemoryParams {
  userId: number;
  content: string;
  source: string;
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
}

export interface UpdateMemoryParams {
  content?: string;
  source?: string;
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
}

export type PublicUser = {
  id: number;
  username: string;
  aboutMe: string;
  customBehavior: string;
  isAdmin: boolean;
  isOwner: boolean;
};
export type Chat = { id: number; title: string; createdAt: string };
export type SavedMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model?: string;
  createdAt: string;
  attachments?: AttachmentItem[];
};
export type AttachmentItem = {
  name: string;
  url?: string;
  kind?: "image" | "pdf" | "file";
};
export type SimilarMessage = Pick<SavedMessage, "role" | "content"> & {
  similarity: number;
};

export type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  about_me?: string;
  custom_behavior?: string;
  is_admin?: boolean;
  is_owner?: boolean;
};

export type SessionRow = UserRow;

export type ToolContent = { type?: string; text?: string };
export type ToolExecution = {
  ok: boolean;
  text: string;
};
export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type PersistedLog = {
  loggedAt: Date;
  level: string;
  event: string;
  metadata: Record<string, string | number | boolean>;
};

export type UploadedFile = {
  name: string;
  kind: "image" | "pdf" | "file";
  content?: string;
  data?: string;
};

export type AiModelType = "ollama" | "comfyui";
