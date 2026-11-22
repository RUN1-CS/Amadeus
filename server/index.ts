// Starts the Node server and opens the WebSocket after Ollama models are loaded.
import { port } from "./config.js";
import { loadModels } from "./ai.js";
import { loadComfyModels } from "./comfyui.js";
import { createHttpServer } from "./http.js";
import { attachWebSocketServer } from "./websocket.js";
import { initializeDatabase } from "./db.js";
import { getErrorType, logger } from "./logger.js";

try {
  await initializeDatabase();
  await loadModels();
  await loadComfyModels();

  const httpServer = createHttpServer();
  attachWebSocketServer(httpServer);

  httpServer.listen(port, () => {
    logger.info({ event: "server.listening", port });
  });
} catch (error) {
  logger.fatal(
    { event: "server.startup_failed", errorType: getErrorType(error) },
    "Server startup failed",
  );
  process.exitCode = 1;
}
