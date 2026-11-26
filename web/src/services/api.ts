// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 RUN1-CS

// Small fetch wrapper that adds JSON handling and bearer-token auth.
import { createServerError, type ServerErrorPayload } from "@/services/serverErrors";

const apiBase = `http://${window.location.hostname}:8080`;

// Build a small API client that automatically attaches JWT auth and JSON parsing.
export function createApiClient(getToken: () => string | null) {
  return {
    // Send a request to the backend and throw on any non-2xx response.
    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
      const headers = new Headers(options.headers);
      if (options.body instanceof Blob) {
        headers.set("Content-Type", "application/octet-stream");
      } else if (!(options.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
      }
      const token = getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);

      const response = await fetch(`${apiBase}${path}`, { ...options, headers });
      const body = (await response.json()) as T & ServerErrorPayload;
      if (!response.ok) throw createServerError(body);
      return body;
    },

    // Send an authenticated request that returns a file or a non-JSON response.
    async requestResponse(path: string, options: RequestInit = {}) {
      const headers = new Headers(options.headers);
      if (!(options.body instanceof FormData) && !(options.body instanceof Blob)) {
        headers.set("Content-Type", "application/json");
      }
      const token = getToken();
      if (token) headers.set("Authorization", "Bearer " + token);

      const response = await fetch(`${apiBase}${path}`, { ...options, headers });
      if (!response.ok) {
        const body = (await response.json()) as ServerErrorPayload;
        throw createServerError(body);
      }
      return response;
    },
  };
}
