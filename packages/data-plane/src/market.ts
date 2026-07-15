/**
 * Market detection for supported markets: US and HK only.
 *
 * A-shares (.SS/.SZ, bare 6-digit codes) were delisted from coverage on
 * 2026-07-15 (docs/PLAN.md v3 市场聚焦). Existing user records that still hold
 * such tickers must map to "unsupported" — never silently deleted, never routed
 * to any adapter (every supports() returns false for it), and rendered by the
 * UI as "已停止覆盖".
 */
export type Market = "US" | "HK" | "unsupported";

export function detectMarket(ticker: string): Market {
  const value = String(ticker || "").trim().toUpperCase();
  if (/^\d{6}\.(SS|SZ)$/.test(value) || /^\d{6}$/.test(value)) return "unsupported";
  if (/^\d{1,5}(?:\.HK)?$/.test(value)) return "HK";
  return "US";
}

export const isUS = (ticker: string) => detectMarket(ticker) === "US";
export const isHK = (ticker: string) => detectMarket(ticker) === "HK";

export function hkCode(ticker: string) {
  return String(ticker || "").trim().toUpperCase().replace(/\.HK$/, "").padStart(4, "0");
}

export function normalizeTicker(ticker: string) {
  const raw = String(ticker || "").trim().toUpperCase();
  const market = detectMarket(raw);
  if (market === "HK") return `${hkCode(raw)}.HK`;
  return raw;
}
