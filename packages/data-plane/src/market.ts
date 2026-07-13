/**
 * Re-exports src/market.js's detectMarket() rather than redefining it — this
 * package must agree with every other consumer (22 files per the R-4 survey)
 * on what market a ticker belongs to; a second implementation would be exactly
 * the kind of drift the adapter matrix is supposed to prevent.
 */
import { detectMarket as legacyDetectMarket } from "../../../src/market.js";

export type Market = "US" | "HK" | "CN";

export function detectMarket(ticker: string): Market {
  return legacyDetectMarket(ticker) as Market;
}
