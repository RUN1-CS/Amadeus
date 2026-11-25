// Postgres access layer for users, chat sessions, messages, and vector-memory lookups.
// This file only re-exports the public API; the implementation lives in ./db/*.
export {
  initializeDatabase,
  reconcileUsersAfterRestore,
} from "./db/lifecycle.js";
export { register, login, updateAccount, deleteAccount } from "./db/users.js";
export { createSession, getUserBySession } from "./db/sessions.js";
export {
  isAdmin,
  setUserRole,
  getAdminOverview,
  getAdminUsers,
  getServerLogs,
} from "./db/admin.js";
export {
  getAiModelAccess,
  isAiModelEnabled,
  setAiModelEnabled,
} from "./db/model_access.js";
export {
  listChats,
  createChat,
  deleteChat,
  renameChat,
  ownsChat,
} from "./db/chats.js";
export { getChatMessages, saveMessage } from "./db/messages.js";
export {
  getMemoriesByUserId,
  getMemoryById,
  createMemory,
  updateMemory,
  deleteMemory,
} from "./db/memories.js";
export {
  searchSimilarMessages,
  searchMemoriesByEmbedding,
} from "./db/vector_search.js";
