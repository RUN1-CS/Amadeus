const wikipediaApiUrl = "https://en.wikipedia.org/w/api.php";
const wikipediaRestUrl = "https://en.wikipedia.org/api/rest_v1/page/summary";
const maxResults = 3;
const maxContextLength = 6_000;

type SearchResponse = {
  query?: {
    search?: Array<{ title?: unknown }>;
  };
};

type SummaryResponse = {
  title?: unknown;
  description?: unknown;
  extract?: unknown;
  content_urls?: {
    desktop?: { page?: unknown };
  };
};

async function fetchJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Amadeus/1.0 (Wikipedia assistant)" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

export async function searchWikipedia(query: string) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return "";

  const searchUrl = new URL(wikipediaApiUrl);
  searchUrl.search = new URLSearchParams({
    action: "query",
    format: "json",
    list: "search",
    srlimit: String(maxResults),
    srsearch: trimmedQuery.slice(0, 300),
  }).toString();
  const search = await fetchJson<SearchResponse>(searchUrl.toString());
  const titles = (search?.query?.search ?? [])
    .map((result) => (typeof result.title === "string" ? result.title : ""))
    .filter(Boolean);

  const summaries = await Promise.all(
    titles.map((title) =>
      fetchJson<SummaryResponse>(
        `${wikipediaRestUrl}/${encodeURIComponent(title.replaceAll(" ", "_"))}`,
      ),
    ),
  );
  const context = summaries
    .filter(
      (
        summary,
      ): summary is SummaryResponse & {
        title: string;
        extract: string;
      } =>
        typeof summary?.title === "string" &&
        typeof summary.extract === "string" &&
        summary.extract.trim().length > 0,
    )
    .map((summary) => {
      const description =
        typeof summary.description === "string"
          ? ` (${summary.description})`
          : "";
      const page =
        typeof summary.content_urls?.desktop?.page === "string"
          ? `\nSource: ${summary.content_urls.desktop.page}`
          : "";
      return `### ${summary.title}${description}\n${summary.extract}${page}`;
    })
    .join("\n\n")
    .slice(0, maxContextLength);

  return context;
}
