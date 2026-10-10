const apiBase = `http://${window.location.hostname}:8080`;

export function createApiClient(getToken: () => string | null) {
  return {
    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
      const headers = new Headers(options.headers);
      headers.set("Content-Type", "application/json");
      const token = getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);

      const response = await fetch(`${apiBase}${path}`, { ...options, headers });
      const body = (await response.json()) as T & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Request failed.");
      return body;
    },
  };
}
