// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Connects the app to Ollama, manages memory context, and orchestrates tool-enabled chats.
// This file only re-exports the public API; the implementation lives in ./ai/.
export { ollama } from "./ai/client.js";
export { loadModels, getModels, releaseModelForImage } from "./ai/models.js";
export { getMessageEmbedding } from "./ai/embeddings.js";
export { buildChatRequest } from "./ai/request.js";
export type { BuiltChatRequest } from "./ai/request.js";
export { chatWithTools } from "./ai/chat.js";
export { looksLikeImageRequest, decideImageGeneration } from "./ai/image.js";
export { generateChatTitle } from "./ai/title.js";
