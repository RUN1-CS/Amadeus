// Shared message contract for the client/server WebSocket protocol.
export type ClientMessage = {
  type:
    | "authenticate"
    | "fetch_models"
    | "message"
    | "generate_image"
    | "memory";
  token?: string;
  chatId?: number;
  model?: string;
  prompt?: string;
  tsundere?: boolean;
  thinking?: boolean;
  stream?: boolean;
  positivePrompt?: string;
  negativePrompt?: string;
  generativeModel?: string;
};
