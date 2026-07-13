/** Unified Quote/Fundamentals/News/Filings/Calendar provider ports. */
import type { Market } from "./market.js";
import type { AdapterAuthorization } from "./authorization.js";

export type ProviderStatus = "ok" | "missing";

/** Normalized quote returned by every quote provider. */
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
  /** Stable provider id used in logs and quality reports. */
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

/** Shared provider envelope; each port adds its own structured fields. */
export interface ProviderEnvelope {
  providerStatus: "ok" | "missing" | "error";
  source?: string | null;
  asOf?: string;
  [key: string]: unknown;
}

export interface FundamentalsPort extends Adapter {
  fetchFundamentals(ticker: string): Promise<ProviderEnvelope>;
}

export interface NewsPort extends Adapter {
  fetchNews(ticker: string): Promise<Record<string, unknown>>;
}

export interface FilingsPort extends Adapter {
  fetchFilings(ticker: string): Promise<ProviderEnvelope>;
}

export interface CalendarPort extends Adapter {
  fetchNextEarnings(ticker: string): Promise<ProviderEnvelope>;
}
