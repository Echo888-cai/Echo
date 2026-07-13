/**
 * The quote registry + the one call callers actually need: getQuote(ticker,
 * opts). Wraps router.selectAdapter() with the registered QuotePort list so
 * call sites don't need to know the adapter set exists — same ergonomics as
 * calling src/marketData.js's getMarketSnapshot() directly today, but now
 * commercial-mode-aware and quality-guarded.
 */
import { postgresQuoteAdapter } from "./adapters/postgresQuoteAdapter.js";
import { yahooQuoteAdapter } from "./adapters/yahooQuoteAdapter.js";
import { postgresFundamentalsAdapter } from "./adapters/postgresFundamentalsAdapter.js";
import { postgresFilingsAdapter } from "./adapters/postgresFilingsAdapter.js";
import { postgresCalendarAdapter } from "./adapters/postgresCalendarAdapter.js";
import { detectMarket, type Market } from "./market.js";
import { selectAdapter, type SelectOptions } from "./router.js";
import { checkQuote, checkEnvelope, type QualityReport } from "./qualityGuard.js";
import type { QuotePort, QuoteResult, FundamentalsPort, FilingsPort, CalendarPort, ProviderEnvelope } from "./ports.js";

// Registration point for future adapters (e.g. a licensed Wind/Polygon/HKEX
// distributor feed) — add to the relevant array, nothing else in this file
// changes; the router already re-ranks whatever's registered.
const quoteAdapters: QuotePort[] = [postgresQuoteAdapter];
// 真实外部行情源，供快照刷新链路使用；与读缓存的 postgresQuoteAdapter 分开注册，
// 避免"读缓存→写缓存"的循环。新的付费源（Polygon/Wind 等）注册到这里。
const liveQuoteAdapters: QuotePort[] = [yahooQuoteAdapter];
const fundamentalsAdapters: FundamentalsPort[] = [postgresFundamentalsAdapter];
const filingsAdapters: FilingsPort[] = [postgresFilingsAdapter];
const calendarAdapters: CalendarPort[] = [postgresCalendarAdapter];

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

/** 直连外部行情源取实时报价（跳过 Postgres 缓存适配器），由快照刷新链路调用。 */
export async function fetchLiveQuote(ticker: string, opts: SelectOptions = {}): Promise<Routed<QuoteResult>> {
  const market = detectMarket(ticker);
  const selection = selectAdapter(liveQuoteAdapters, market, opts);
  if (!selection) throw new NoAuthorizedAdapterError("live-quote", market);
  const result = await selection.adapter.fetchQuote(ticker);
  return { result, adapterId: selection.adapter.id, quality: checkQuote(result) };
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

export async function getNextEarnings(ticker: string, opts: SelectOptions = {}): Promise<Routed<ProviderEnvelope>> {
  const market = detectMarket(ticker);
  const selection = selectAdapter(calendarAdapters, market, opts);
  if (!selection) throw new NoAuthorizedAdapterError("calendar", market);
  const result = await selection.adapter.fetchNextEarnings(ticker);
  return { result, adapterId: selection.adapter.id, quality: checkEnvelope(result) };
}
