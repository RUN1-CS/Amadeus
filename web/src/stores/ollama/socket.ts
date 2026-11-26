// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// WebSocket connection: auth handshake, send helper, and reconnect with backoff.

// Keep below the server's WebSocket maxPayload (25 MiB) so a big image upload
// shows an error instead of silently dropping the connection.
export const maxSocketPayloadChars = 24 * 1024 * 1024;
const maxReconnectDelayMs = 30_000;

// WebSocket endpoint: VITE_WS_URL wins, otherwise match the page's protocol (wss on https).
function socketUrl() {
  const configured = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
    ?.VITE_WS_URL;
  if (configured) return configured;
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.hostname}:8080`;
}

type SocketClientOptions = {
  getToken: () => string | null;
  onMessage: (raw: string) => void;
  // Called when the connection drops on its own (not via disconnect()), before a reconnect is scheduled.
  onUnexpectedClose: () => void;
};

export function createSocketClient({
  getToken,
  onMessage,
  onUnexpectedClose,
}: SocketClientOptions) {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempts = 0;

  function isOpen() {
    return socket !== null && socket.readyState === WebSocket.OPEN;
  }

  // Returns false when the socket is not open, so callers can show an error.
  function send(data: string) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(data);
    return true;
  }

  // Retry a dropped connection with exponential backoff while a session exists.
  function scheduleReconnect() {
    if (!getToken()) return;
    const delay = Math.min(maxReconnectDelayMs, 1_000 * 2 ** reconnectAttempts);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(connect, delay);
  }

  // Open the WebSocket and authenticate it when the browser has a valid token.
  function connect() {
    if (!getToken() || socket) return;
    clearTimeout(reconnectTimer);

    const ws = new WebSocket(socketUrl());
    socket = ws;
    ws.addEventListener("open", () => {
      reconnectAttempts = 0;
      ws.send(JSON.stringify({ type: "authenticate", token: getToken() }));
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") onMessage(event.data);
    });
    ws.addEventListener("close", () => {
      // A socket that was replaced or closed on purpose (logout) must not reconnect.
      if (socket !== ws) return;
      socket = null;
      onUnexpectedClose();
      scheduleReconnect();
    });
  }

  // Close on purpose: detach first so the close handler doesn't try to reconnect.
  function disconnect() {
    clearTimeout(reconnectTimer);
    reconnectAttempts = 0;
    const closing = socket;
    socket = null;
    closing?.close();
  }

  return { connect, disconnect, isOpen, send };
}

export type SocketClient = ReturnType<typeof createSocketClient>;
