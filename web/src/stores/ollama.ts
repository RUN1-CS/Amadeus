import { ref } from "vue";
import { defineStore } from "pinia";

type ModelValue = string | { name?: string };

type ModelMessage = {
  type: "models";
  models?: ModelValue[];
};

type AssistantMessage = {
  type: "message";
  message: {
    content?: string;
  };
};

type ErrorMessage = {
  type: "error";
  error: string;
};

type ServerMessage = ModelMessage | AssistantMessage | ErrorMessage | { type: "done" };

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  time: string;
  model?: string;
};

export const useOllamaStore = defineStore("ollama", () => {
  const models = ref<string[]>([]);
  const selectedModel = ref("");
  const draft = ref("");
  const isGenerating = ref(false);
  const tsundere = ref(false);
  const thinking = ref(false);
  const streaming = ref(true);
  const messageList = ref<ChatMessage[]>([]);

  const socket = new WebSocket(`ws://${window.location.hostname}:8080`);

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "fetch_models" }));
  });

  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      receiveMessage(event.data);
    }
  });

  function setModels(values: ModelValue[]) {
    const nextModels = values
      .map((model) => (typeof model === "string" ? model : (model.name ?? "")))
      .filter((model): model is string => Boolean(model));

    models.value = [...new Set(nextModels)];
    if (!selectedModel.value || !models.value.includes(selectedModel.value)) {
      selectedModel.value = models.value[0] ?? "";
    }
  }

  function receiveMessage(rawMessage: string) {
    try {
      const message = JSON.parse(rawMessage) as ServerMessage;
      if (message.type === "models" && Array.isArray(message.models)) {
        setModels(message.models);
      } else if (message.type === "message") {
        const content = message.message.content ?? "";
        addAssistantMessage(content);
      } else if (message.type === "error") {
        isGenerating.value = false;
        addAssistantMessage(`Error: ${message.error}`);
      } else if (message.type === "done") {
        isGenerating.value = false;
      }
    } catch {
      // Ignore non-JSON socket messages so the chat remains available.
    }
  }

  function addAssistantMessage(content: string) {
    const lastMessage = messageList.value.at(-1);

    if (lastMessage?.role === "assistant" && isGenerating.value) {
      lastMessage.content += content;
    } else {
      messageList.value.push({
        id: Date.now(),
        role: "assistant",
        content,
        time: "now",
        model: selectedModel.value,
      });
    }
  }

  function selectPrompt(prompt: string) {
    draft.value = prompt;
  }

  function clearMessages() {
    messageList.value = [];
  }

  function sendMessage() {
    const content = draft.value.trim();
    if (!content || isGenerating.value || socket.readyState !== WebSocket.OPEN) return;

    messageList.value.push({
      id: Date.now(),
      role: "user",
      content,
      time: "now",
    });
    draft.value = "";
    isGenerating.value = true;

    socket.send(
      JSON.stringify({
        type: "message",
        model: selectedModel.value,
        prompt: content,
        tsundere: tsundere.value,
        thinking: thinking.value,
        stream: streaming.value,
      }),
    );
  }

  return {
    models,
    selectedModel,
    draft,
    isGenerating,
    tsundere,
    thinking,
    streaming,
    messageList,
    setModels,
    receiveMessage,
    selectPrompt,
    clearMessages,
    sendMessage,
  };
});
