// Small fetch wrapper that adds JSON handling and bearer-token auth.
const apiBase = `http://${window.location.hostname}:8080`;

// Build a small API client that automatically attaches JWT auth and JSON parsing.
export function createApiClient(getToken: () => string | null) {
  return {
    // Send a request to the backend and throw on any non-2xx response.
    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
      const headers = new Headers(options.headers);
      if (!(options.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
      }
      const token = getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);

      const response = await fetch(`${apiBase}${path}`, { ...options, headers });
      const body = (await response.json()) as T & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Request failed.");
      return body;
    },
  };
}
