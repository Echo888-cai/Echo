import { normalizeTicker, type Market } from "../market.js";
import type { QuotePort, QuoteResult } from "../ports.js";

const REQUEST_HEADERS = { "user-agent": "Mozilla/5.0", accept: "application/json" };
// query1 对无 cookie 客户端限流更激进，query2 承载同一数据；先 query2，被限流再退 query1。
const HOSTS = ["query2.finance.yahoo.com", "query1.finance.yahoo.com"];

function lastFinite(values: unknown): number | null {
  if (!Array.isArray(values)) return null;
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Yahoo Finance 公共 chart 接口，港/美股与外汇（如 HKDUSD=X）通用，无需密钥。
 * 仅限研究用途；商用模式下 router 会因 commercialUseAllowed=false 自动排除它。
 */
export const yahooQuoteAdapter: QuotePort = {
  id: "yahoo-chart",
  authorization: {
    licenseTier: "unlicensed_free_tier",
    commercialUseAllowed: false,
    costPerCallUsd: 0,
    notes: "Yahoo Finance public chart API; research/dev only. Never eligible in commercial mode."
  },
  // Ranked below the US-only keyed adapters (finnhub=1, twelvedata=2) since
  // those are official exchange-sourced feeds when they're eligible; Yahoo's
  // public chart endpoint remains the only source with HK coverage, so it's
  // still what actually gets selected for that market regardless of rank.
  qualityRank: 3,
  supports(market: Market) { return market !== "unsupported"; },
  async fetchQuote(rawTicker: string): Promise<QuoteResult> {
    const ticker = normalizeTicker(rawTicker);
    let response: Response | null = null;
    for (const host of HOSTS) {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
      response = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(10_000) });
      if (response.ok) break;
    }
    if (!response?.ok) throw new Error(`yahoo chart ${response?.status} for ${ticker}`);
    const body: any = await response.json();
    if (body?.chart?.error) throw new Error(`yahoo chart error for ${ticker}: ${body.chart.error.code || "unknown"}`);
    const result = body?.chart?.result?.[0];
    const meta = result?.meta || {};
    const quote = result?.indicators?.quote?.[0] || {};
    const price = finiteOrNull(meta.regularMarketPrice);
    const previousClose = finiteOrNull(meta.regularMarketPreviousClose) ?? finiteOrNull(meta.chartPreviousClose) ?? finiteOrNull(meta.previousClose);
    // 涨跌幅是同一快照两个官方价的展示口径换算，不参与估值计算。
    const change = price != null && previousClose != null ? price - previousClose : null;
    const changePercent = change != null && previousClose ? (change / previousClose) * 100 : null;
    return {
      source: "yahoo",
      ticker,
      currency: typeof meta.currency === "string" ? meta.currency : null,
      price,
      previousClose,
      change,
      changePercent,
      open: lastFinite(quote.open),
      high: finiteOrNull(meta.regularMarketDayHigh) ?? lastFinite(quote.high),
      low: finiteOrNull(meta.regularMarketDayLow) ?? lastFinite(quote.low),
      volume: finiteOrNull(meta.regularMarketVolume) ?? lastFinite(quote.volume),
      marketCap: null,
      pe: null,
      dividendYield: null,
      week52High: finiteOrNull(meta.fiftyTwoWeekHigh),
      week52Low: finiteOrNull(meta.fiftyTwoWeekLow),
      asOf: finiteOrNull(meta.regularMarketTime) ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
      providerStatus: price == null ? "missing" : "ok"
    };
  }
};
