// Shared message contract for the client/server WebSocket protocol.
export type ClientMessage = {
  type: "authenticate" | "fetch_models" | "message" | "memory";
  token?: string;
  chatId?: number;
  model?: string;
  prompt?: string;
  tsundere?: boolean;
  thinking?: boolean;
  stream?: boolean;
};
