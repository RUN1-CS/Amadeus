// Front-end chat, user, and message types shared across the app.
export type User = {
  id: number;
  username: string;
  aboutMe: string;
  customBehavior: string;
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
  };
};

export type ErrorMessage = {
  type: "error";
  error: string;
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
