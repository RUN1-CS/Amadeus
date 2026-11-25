// Front-end chat, user, and message types shared across the app.
export type User = {
  id: number;
  username: string;
  aboutMe: string;
  customBehavior: string;
  isAdmin: boolean;
  isOwner: boolean;
};

export type Chat = {
  id: number;
  title: string;
  createdAt: string;
};

export type SavedMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model?: string;
  createdAt: string;
  attachments?: AttachmentItem[];
};

export interface AttachmentItem {
  name: string;
  url?: string;
  content?: string;
  lastModified?: number;
  kind?: "image" | "pdf" | "file";
}

export interface ChatMessage {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  model?: string;
  time?: string;
  thinking?: string;
  attachments?: AttachmentItem[];
}

export type ModelValue = string | { name?: string };

export type AssistantMessage = {
  type: "message";
  message: {
    content?: string;
    thinking?: string;
    attachments?: AttachmentItem[];
  };
  full?: boolean;
};

export type ErrorMessage = {
  type: "error";
  error: string;
  localizationCode?: string;
  localizationParams?: Record<string, string | number>;
};

export type ChatTitleMessage = {
  type: "chat_title";
  chat: Chat;
};

export type ModelMessage = {
  type: "models";
  models?: ModelValue[];
};

export type ServerMessage =
  | ModelMessage
  | AssistantMessage
  | ErrorMessage
  | ChatTitleMessage
  | { type: "authenticated"; user: User }
  | { type: "done" };

export interface Memory {
  id: number;
  user_id: number;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  embedding?: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryPayload {
  content: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface Language {
  code: string;
  name: string;
}
