/**
 * Tavily web search adapter — returns structured evidence items for the
 * research pipeline's `webEvidence` slot. Unlike quote/fundamentals adapters
 * this is query-based (not market-routed), so it exports a simple async
 * function rather than implementing a market-keyed port.
 *
 * Graceful degradation: missing key → adapter not registered; API/network
 * errors → empty results (never throws into the research pipeline).
 */

export interface WebEvidenceItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
  date: string | null;
  relevanceScore: number;
}

export interface WebSearchResult {
  evidence: WebEvidenceItem[];
  query: string;
  provider: string;
  searchedAt: string;
}

async function isUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(3_000),
      redirect: "follow"
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const tavilySearchAdapter = {
  id: "tavily",

  isConfigured(): boolean {
    return Boolean(process.env.TAVILY_API_KEY);
  },

  async search(query: string, maxResults = 5): Promise<WebSearchResult> {
    const apiKey = process.env.TAVILY_API_KEY;
    const searchedAt = new Date().toISOString();
    const empty: WebSearchResult = { evidence: [], query, provider: "tavily", searchedAt };

    if (!apiKey) return empty;
    if (!query.trim()) return empty;

    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query: query.trim(),
          search_depth: "basic",
          max_results: Math.min(maxResults, 10)
        }),
        signal: AbortSignal.timeout(10_000)
      });

      if (!response.ok) return empty;

      const body: any = await response.json();
      const rawResults: any[] = Array.isArray(body?.results) ? body.results : [];

      const checks = await Promise.allSettled(
        rawResults.map((item) => isUrlReachable(item.url))
      );

      const evidence: WebEvidenceItem[] = [];
      for (let i = 0; i < rawResults.length; i++) {
        const check = checks[i];
        const reachable = check.status === "fulfilled" && check.value;
        if (!reachable) continue;

        const item = rawResults[i];
        evidence.push({
          title: item.title || "",
          url: item.url || "",
          snippet: item.content || "",
          source: extractDomain(item.url),
          date: null,
          relevanceScore: typeof item.score === "number" ? item.score : 0
        });
      }

      return { evidence, query, provider: "tavily", searchedAt };
    } catch {
      return empty;
    }
  }
};

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
