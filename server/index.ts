import { port } from "./config.js";
import { loadModels } from "./ai.js";
import { createHttpServer } from "./http.js";
import { attachWebSocketServer } from "./websocket.js";

await loadModels();

const httpServer = createHttpServer();
attachWebSocketServer(httpServer);

httpServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
