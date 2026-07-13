/**
 * The quote registry + the one call callers actually need: getQuote(ticker,
 * opts). Wraps router.selectAdapter() with the registered QuotePort list so
 * call sites don't need to know the adapter set exists — same ergonomics as
 * calling src/marketData.js's getMarketSnapshot() directly today, but now
 * commercial-mode-aware and quality-guarded.
 */
import { legacyFreeQuoteAdapter } from "./adapters/legacyFreeQuoteAdapter.js";
import { detectMarket } from "./market.js";
import { selectAdapter, type SelectOptions } from "./router.js";
import { checkQuote, type QualityReport } from "./qualityGuard.js";
import type { QuotePort, QuoteResult } from "./ports.js";

// Registration point for future adapters (e.g. a licensed Wind/Polygon/HKEX
// distributor feed) — add to this array, nothing else in this file changes.
const quoteAdapters: QuotePort[] = [legacyFreeQuoteAdapter];

export interface RoutedQuote {
  result: QuoteResult;
  adapterId: string;
  quality: QualityReport;
}

export class NoAuthorizedAdapterError extends Error {
  constructor(market: string) {
    super(`No adapter authorized to serve quotes for market ${market} in commercial mode`);
    this.name = "NoAuthorizedAdapterError";
  }
}

export async function getQuote(ticker: string, opts: SelectOptions = {}): Promise<RoutedQuote> {
  const market = detectMarket(ticker);
  const selection = selectAdapter(quoteAdapters, market, opts);
  if (!selection) throw new NoAuthorizedAdapterError(market);
  const result = await selection.adapter.fetchQuote(ticker);
  return { result, adapterId: selection.adapter.id, quality: checkQuote(result) };
}
