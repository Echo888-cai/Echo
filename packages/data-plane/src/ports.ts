/**
 * Port interfaces (REFACTOR_PROPOSAL.md §4.5's "统一端口（Quote/Fundamentals/
 * News/Filings/Calendar）"). Only QuotePort has a registered adapter in this
 * slice (see adapters/legacyFreeQuoteAdapter.ts + registry.ts); the other four
 * are declared here so the matrix's target shape is visible and the next
 * slice has a contract to implement against, not a blank page.
 */
import type { Market } from "./market.js";
import type { AdapterAuthorization } from "./authorization.js";

export type ProviderStatus = "ok" | "missing";

/** Mirrors src/marketData.js's getMarketSnapshot() return shape exactly — the
 *  legacy adapter passes it through unchanged (see legacyFreeQuoteAdapter.ts). */
export interface QuoteResult {
  source: string;
  ticker: string;
  currency: string | null;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap: number | null;
  pe: number | null;
  dividendYield: number | null;
  week52High: number | null;
  week52Low: number | null;
  asOf: string;
  providerStatus: ProviderStatus;
  errors?: string[];
}

interface Adapter {
  /** Stable id, e.g. "legacy-free-tier". Used in logs/quality-guard reports. */
  id: string;
  authorization: AdapterAuthorization;
  /** Whether this adapter has any coverage for the given market at all. */
  supports(market: Market): boolean;
  /** Declared quality rank among adapters that support the same market — lower
   *  is better (1 = best). Ties broken by authorization.slaLatencyMsP95. */
  qualityRank: number;
}

export interface QuotePort extends Adapter {
  fetchQuote(ticker: string): Promise<QuoteResult>;
}

// ── Scaffolding for the remaining four ports — types intentionally loose
// (`unknown`/`Record`) since no adapter implements them yet; tightening these
// is the next slice's job once there's a second (real) adapter per port to
// design the shape against, not a guess made in isolation now.

/** Loose envelope shared by financialData.js/filingData.js/earningsCalendar.js
 *  return values — each carries its own richer fields on top of this, but
 *  providerStatus is the one thing every port/adapter/quality-check needs. */
export interface ProviderEnvelope {
  providerStatus: "ok" | "missing" | "error";
  source?: string | null;
  asOf?: string;
  [key: string]: unknown;
}

export interface FundamentalsPort extends Adapter {
  fetchFundamentals(ticker: string): Promise<ProviderEnvelope>;
}

// News scaffolding stays a type placeholder — getNewsSnapshot(company) takes a
// company object (ticker + name + aliases), not a bare ticker, so wrapping it
// needs a slightly different port shape than the other four; deferred to the
// slice that actually needs a second news adapter to design against.
export interface NewsPort extends Adapter {
  fetchNews(ticker: string): Promise<Record<string, unknown>>;
}

export interface FilingsPort extends Adapter {
  fetchFilings(ticker: string): Promise<ProviderEnvelope>;
}

export interface CalendarPort extends Adapter {
  fetchNextEarnings(ticker: string): Promise<ProviderEnvelope>;
}
