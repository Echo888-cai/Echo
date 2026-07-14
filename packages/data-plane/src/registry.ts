/**
 * The quote registry + the one call callers actually need: getQuote(ticker,
 * opts). Wraps router.selectAdapter() with the registered QuotePort list so
 * call sites don't need to know the adapter set exists — same ergonomics as
 * calling src/marketData.js's getMarketSnapshot() directly today, but now
 * commercial-mode-aware and quality-guarded.
 */
import { postgresQuoteAdapter } from "./adapters/postgresQuoteAdapter.js";
import { yahooQuoteAdapter } from "./adapters/yahooQuoteAdapter.js";
import { finnhubQuoteAdapter } from "./adapters/finnhubQuoteAdapter.js";
import { twelveDataQuoteAdapter } from "./adapters/twelveDataQuoteAdapter.js";
import { alphaVantageQuoteAdapter } from "./adapters/alphaVantageQuoteAdapter.js";
import { postgresFundamentalsAdapter } from "./adapters/postgresFundamentalsAdapter.js";
import { fmpFundamentalsAdapter } from "./adapters/fmpFundamentalsAdapter.js";
import { postgresFilingsAdapter } from "./adapters/postgresFilingsAdapter.js";
import { postgresCalendarAdapter } from "./adapters/postgresCalendarAdapter.js";
import { finnhubCalendarAdapter } from "./adapters/finnhubCalendarAdapter.js";
import { hkAdrCalendarAdapter } from "./adapters/hkAdrCalendarAdapter.js";
import { detectMarket, type Market } from "./market.js";
import { selectAdapter, selectAdapterChain, type SelectOptions } from "./router.js";
import { isBreakerOpen, recordFailure, recordSuccess } from "./circuitBreaker.js";
import { checkQuote, checkEnvelope, type QualityReport } from "./qualityGuard.js";
import type { QuotePort, QuoteResult, FundamentalsPort, FilingsPort, CalendarPort, ProviderEnvelope } from "./ports.js";

// Registration point for future adapters (e.g. a licensed Wind/Polygon/HKEX
// distributor feed) — add to the relevant array, nothing else in this file
// changes; the router already re-ranks whatever's registered.
const quoteAdapters: QuotePort[] = [postgresQuoteAdapter];
// 真实外部行情源，供快照刷新链路使用；与读缓存的 postgresQuoteAdapter 分开注册，
// 避免"读缓存→写缓存"的循环。新的付费源（Polygon/Wind 等）注册到这里。
// Only registered here if their API key is actually set — an adapter with no
// key would just throw on every call, which is indistinguishable from "this
// provider is down" and would trip its circuit breaker for no reason.
const liveQuoteAdapters: QuotePort[] = [
  ...(process.env.FINNHUB_API_KEY ? [finnhubQuoteAdapter] : []),
  ...(process.env.TWELVEDATA_API_KEY ? [twelveDataQuoteAdapter] : []),
  yahooQuoteAdapter,
  ...(process.env.ALPHAVANTAGE_API_KEY ? [alphaVantageQuoteAdapter] : [])
];
const fundamentalsAdapters: FundamentalsPort[] = [
  postgresFundamentalsAdapter,
  ...(process.env.FMP_API_KEY ? [fmpFundamentalsAdapter] : [])
];
const filingsAdapters: FilingsPort[] = [postgresFilingsAdapter];
const calendarAdapters: CalendarPort[] = [
  ...(process.env.FINNHUB_API_KEY ? [finnhubCalendarAdapter, hkAdrCalendarAdapter] : []),
  postgresCalendarAdapter
];

export interface Routed<T> {
  result: T;
  adapterId: string;
  quality: QualityReport;
}

export class NoAuthorizedAdapterError extends Error {
  constructor(capability: string, market: Market) {
    super(`No adapter authorized to serve ${capability} for market ${market} in commercial mode`);
    this.name = "NoAuthorizedAdapterError";
  }
}

export async function getQuote(ticker: string, opts: SelectOptions = {}): Promise<Routed<QuoteResult>> {
  const market = detectMarket(ticker);
  const selection = selectAdapter(quoteAdapters, market, opts);
  if (!selection) throw new NoAuthorizedAdapterError("quote", market);
  const result = await selection.adapter.fetchQuote(ticker);
  return { result, adapterId: selection.adapter.id, quality: checkQuote(result) };
}

/**
 * 直连外部行情源取实时报价（跳过 Postgres 缓存适配器），由快照刷新链路调用。
 * 按 qualityRank 顺序逐个尝试，任何一个适配器超时/报错/连续熔断都自动降级到
 * 链上下一个候选，而不是把单一供应商的故障直接暴露为整条链路失败（docs/PLAN.md
 * P1"逐级降级到 Yahoo"）。全部候选耗尽才抛出最后一次的错误。
 */
export async function fetchLiveQuote(ticker: string, opts: SelectOptions = {}): Promise<Routed<QuoteResult>> {
  const market = detectMarket(ticker);
  const chain = selectAdapterChain(liveQuoteAdapters, market, opts);
  if (!chain.length) throw new NoAuthorizedAdapterError("live-quote", market);
  let lastError: unknown = null;
  for (const adapter of chain) {
    if (isBreakerOpen(adapter.id)) continue;
    try {
      const result = await adapter.fetchQuote(ticker);
      recordSuccess(adapter.id);
      return { result, adapterId: adapter.id, quality: checkQuote(result) };
    } catch (err) {
      recordFailure(adapter.id);
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`all live quote adapters failed or breaker-open for ${ticker}`);
}

export async function getFundamentals(ticker: string, opts: SelectOptions = {}): Promise<Routed<ProviderEnvelope>> {
  const market = detectMarket(ticker);
  const selection = selectAdapter(fundamentalsAdapters, market, opts);
  if (!selection) throw new NoAuthorizedAdapterError("fundamentals", market);
  const result = await selection.adapter.fetchFundamentals(ticker);
  return { result, adapterId: selection.adapter.id, quality: checkEnvelope(result) };
}

export async function getFilings(ticker: string, opts: SelectOptions = {}): Promise<Routed<ProviderEnvelope>> {
  const market = detectMarket(ticker);
  const selection = selectAdapter(filingsAdapters, market, opts);
  if (!selection) throw new NoAuthorizedAdapterError("filings", market);
  const result = await selection.adapter.fetchFilings(ticker);
  return { result, adapterId: selection.adapter.id, quality: checkEnvelope(result) };
}

/**
 * Calendar uses a fallback chain rather than selectAdapter's single top pick:
 * hkAdrCalendarAdapter declares market-level ("HK") coverage but only
 * actually resolves tickers in its hand-curated ADR map — every other HK
 * ticker legitimately comes back "missing" from it, and that must fall
 * through to postgresCalendarAdapter's cache rather than dead-ending.
 */
export async function getNextEarnings(ticker: string, opts: SelectOptions = {}): Promise<Routed<ProviderEnvelope>> {
  const market = detectMarket(ticker);
  const chain = selectAdapterChain(calendarAdapters, market, opts);
  if (!chain.length) throw new NoAuthorizedAdapterError("calendar", market);
  let last: Routed<ProviderEnvelope> | null = null;
  for (const adapter of chain) {
    try {
      const result = await adapter.fetchNextEarnings(ticker);
      last = { result, adapterId: adapter.id, quality: checkEnvelope(result) };
      if (result.providerStatus === "ok") return last;
    } catch {
      // try the next adapter in the chain
    }
  }
  if (last) return last;
  throw new Error(`all calendar adapters failed for ${ticker}`);
}

/** Read-only view of the registered live quote adapters, for the canary probe script. */
export function listLiveQuoteAdapters(): QuotePort[] {
  return liveQuoteAdapters;
}
