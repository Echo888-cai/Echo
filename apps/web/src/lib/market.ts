// React port of root src/market.js — only the bit watch/portfolio need
// (market badge classification). Not the full provider-symbol-spelling
// file (that's server-side only); this mirrors detectMarket() exactly.
export type Market = "US" | "HK" | "CN";

export function detectMarket(ticker: string | null | undefined): Market {
  const t = String(ticker || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (/\.US$/.test(t)) return "US";
  if (/\.HK$/.test(t)) return "HK";
  if (/\.(SS|SZ)$/.test(t)) return "CN";
  if (/^\d{6}$/.test(t)) return "CN";
  if (/^\d{1,5}$/.test(t)) return "HK";
  if (/^[A-Z][A-Z.]{0,6}$/.test(t)) return "US";
  return "HK";
}
