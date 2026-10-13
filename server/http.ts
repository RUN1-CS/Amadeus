// REST API for auth, chat CRUD, and message history.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  createChat,
  createSession,
  deleteChat,
  getChatMessages,
  getUserBySession,
  listChats,
  login,
  register,
  renameChat,
  updateAccount,
} from "./db.js";
import { getErrorMessage } from "./errors.js";

// Write a JSON response with the CORS headers used by the browser client.
function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  });
  response.end(JSON.stringify(body));
}

// Read the request body once and parse it as JSON for the route handlers.
async function readJson(request: IncomingMessage) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

// Require a valid bearer token before allowing protected API routes.
async function requireUser(request: IncomingMessage, response: ServerResponse) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const user = await getUserBySession(token);
  if (!user) sendJson(response, 401, { error: "Authentication required." });
  return user;
}

// Route each HTTP request to the right auth, account, chat, or message handler.
// It validates the method/path, enforces auth for protected endpoints, and sends
// JSON responses for both success and error cases.
async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const url = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );
  const path = url.pathname;

  try {
    // Register a new account with a username and password.
    if (request.method === "POST" && path === "/api/auth/register") {
      const body = await readJson(request);
      const username = typeof body.username === "string" ? body.username : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!username || password.length < 8) {
        sendJson(response, 400, {
          error: "Use a username and a password of at least 8 characters.",
        });
        return;
      }
      const user = await register(username, password);
      sendJson(response, 201, { user, token: await createSession(user.id) });
      return;
    }

    // Log in an existing user and issue a fresh session token.
    if (request.method === "POST" && path === "/api/auth/login") {
      const body = await readJson(request);
      const user = await login(
        String(body.username ?? ""),
        String(body.password ?? ""),
      );
      if (!user) {
        sendJson(response, 401, { error: "Invalid username or password." });
        return;
      }
      sendJson(response, 200, { user, token: await createSession(user.id) });
      return;
    }

    // Return the logged-in user's public profile for the app shell.
    if (request.method === "GET" && path === "/api/auth/me") {
      const user = await requireUser(request, response);
      if (user) sendJson(response, 200, { user });
      return;
    }

    // Update account fields, including optional password changes, after verifying the current password.
    if (request.method === "PATCH" && path === "/api/auth/account") {
      const user = await requireUser(request, response);
      if (!user) return;
      const body = await readJson(request);
      const username =
        typeof body.username === "string" ? body.username.trim() : "";
      const currentPassword =
        typeof body.currentPassword === "string" ? body.currentPassword : "";
      const newPassword =
        typeof body.newPassword === "string" ? body.newPassword : "";
      const aboutMe = typeof body.aboutMe === "string" ? body.aboutMe : "";
      const customBehavior =
        typeof body.customBehavior === "string" ? body.customBehavior : "";
      if (
        !username ||
        !currentPassword ||
        (newPassword && newPassword.length < 8)
      ) {
        sendJson(response, 400, {
          error:
            "Enter a username, current password, and a valid new password.",
        });
        return;
      }
      const updatedUser = await updateAccount(
        user.id,
        currentPassword,
        username,
        newPassword || undefined,
        aboutMe,
        customBehavior,
      );
      if (!updatedUser) {
        sendJson(response, 401, { error: "Current password is incorrect." });
        return;
      }
      sendJson(response, 200, { user: updatedUser });
      return;
    }

    // From here, every route requires a valid login session.
    const user = await requireUser(request, response);
    if (!user) return;

    // Fetch all chats owned by the signed-in user.
    if (path === "/api/chats" && request.method === "GET") {
      sendJson(response, 200, { chats: await listChats(user.id) });
      return;
    }

    // Create a new conversation for the authenticated user.
    if (path === "/api/chats" && request.method === "POST") {
      const body = await readJson(request);
      const chatId = await createChat(
        user.id,
        typeof body.title === "string" ? body.title : undefined,
      );
      sendJson(response, 201, { chatId });
      return;
    }

    // Rename an existing chat, if it belongs to this user.
    const chatMatch = path.match(/^\/api\/chats\/(\d+)$/);
    if (chatMatch && request.method === "PATCH") {
      const body = await readJson(request);
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        sendJson(response, 400, { error: "Chat name cannot be empty." });
        return;
      }
      const chat = await renameChat(user.id, Number(chatMatch[1]), title);
      if (!chat) {
        sendJson(response, 404, { error: "Chat not found." });
        return;
      }
      sendJson(response, 200, { chat });
      return;
    }

    // Delete a chat only when ownership matches the signed-in user.
    if (chatMatch && request.method === "DELETE") {
      const deleted = await deleteChat(user.id, Number(chatMatch[1]));
      if (!deleted) {
        sendJson(response, 404, { error: "Chat not found." });
        return;
      }
      sendJson(response, 200, { deleted: true });
      return;
    }

    // Load the saved messages for one conversation.
    const messagesMatch = path.match(/^\/api\/chats\/(\d+)\/messages$/);
    if (messagesMatch && request.method === "GET") {
      const messages = await getChatMessages(user.id, Number(messagesMatch[1]));
      if (!messages) {
        sendJson(response, 404, { error: "Chat not found." });
        return;
      }
      sendJson(response, 200, { messages });
      return;
    }

    // Fall through to a 404 when the route does not match any known API endpoint.
    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      sendJson(response, 409, { error: "That username is already taken." });
      return;
    }
    sendJson(response, 500, { error: getErrorMessage(error) });
  }
}

// Start the HTTP server with the route dispatcher attached.
export function createHttpServer() {
  return createServer((request, response) => {
    void handleRequest(request, response);
  });
}
