import { Ollama } from "ollama";
import { WebSocketServer, type RawData, type WebSocket } from "ws";

const wss = new WebSocketServer({ port: 8080 });
const ollama = new Ollama({
  host: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
});

type ClientMessage = {
  type: "fetch_models" | "message";
  model?: string;
  prompt?: string;
  tsundere?: boolean;
  thinking?: boolean;
  stream?: boolean;
};

async function fetchModels() {
  const { models } = await ollama.list();
  return models;
}

let models: Awaited<ReturnType<typeof fetchModels>> = [];
let modelLoadError: string | undefined;

try {
  models = await fetchModels();
} catch (error) {
  modelLoadError = getErrorMessage(error);
  console.error("Could not load Ollama models:", error);
}

function parseMessage(message: RawData): ClientMessage {
  return JSON.parse(message.toString()) as ClientMessage;
}

async function sendMessage(ws: WebSocket, data: ClientMessage): Promise<void> {
  const model = data.model;
  let prompt = data.prompt ?? "";
  const tsundere = data.tsundere;

  if (tsundere) {
    prompt +=
      "\n\nYou are a tsundere. You will respond in a tsundere manner, being cold and aloof, but secretly caring and affectionate.";
  }

  if (data.stream) {
    const response = await ollama.chat({
      model: model ?? "",
      messages: [{ role: "user", content: prompt }],
      think: data.thinking ?? false,
      stream: true,
    });

    for await (const chunk of response) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      ws.send(JSON.stringify({ type: "message", message: chunk.message }));
    }
    ws.send(JSON.stringify({ type: "done" }));
  } else {
    const response = await ollama.chat({
      model: model ?? "",
      messages: [{ role: "user", content: prompt }],
      think: data.thinking ?? false,
      stream: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    ws.send(JSON.stringify({ type: "message", message: response.message }));
    ws.send(JSON.stringify({ type: "done" }));
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "An unexpected server error occurred.";
}

async function handleMessage(ws: WebSocket, message: RawData): Promise<void> {
  try {
    const data = parseMessage(message);

    switch (data.type) {
      case "fetch_models":
        ws.send(JSON.stringify({ type: "models", models }));
        if (modelLoadError) {
          ws.send(JSON.stringify({ type: "error", error: modelLoadError }));
        }
        break;
      case "message":
        await sendMessage(ws, data);
        break;
      default:
        console.error("Unknown message type:", data.type);
    }
  } catch (error) {
    console.error("Ollama request failed:", error);
    ws.send(JSON.stringify({ type: "error", error: getErrorMessage(error) }));
    ws.send(JSON.stringify({ type: "done" }));
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    void handleMessage(ws, message);
  });
});
