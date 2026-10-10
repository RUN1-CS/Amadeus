export type User = {
  id: number;
  username: string;
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
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  time: string;
  model?: string;
};

export type ModelValue = string | { name?: string };
