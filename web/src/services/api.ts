// Small fetch wrapper that adds JSON handling and bearer-token auth.
import i18n from "@/i18n";

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
      const body = (await response.json()) as T & { error?: string };
      if (!response.ok) throw new Error(body.error ?? i18n.global.t("api.requestFailed"));
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
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? i18n.global.t("api.requestFailed"));
      }
      return response;
    },
  };
}
