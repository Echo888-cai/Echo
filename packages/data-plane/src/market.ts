export type Market = "US" | "HK" | "CN";

export function detectMarket(ticker: string): Market {
  const value = String(ticker || "").trim().toUpperCase();
  if (/^\d{6}\.(SS|SZ)$/.test(value) || /^\d{6}$/.test(value)) return "CN";
  if (/^\d{1,5}(?:\.HK)?$/.test(value)) return "HK";
  return "US";
}

export const isUS = (ticker: string) => detectMarket(ticker) === "US";
export const isCN = (ticker: string) => detectMarket(ticker) === "CN";
export const isHK = (ticker: string) => detectMarket(ticker) === "HK";

export function hkCode(ticker: string) {
  return String(ticker || "").trim().toUpperCase().replace(/\.HK$/, "").padStart(4, "0");
}

export function normalizeTicker(ticker: string) {
  const raw = String(ticker || "").trim().toUpperCase();
  const market = detectMarket(raw);
  if (market === "HK") return `${hkCode(raw)}.HK`;
  if (market === "CN") return cnTicker(raw);
  return raw;
}

export function cnCode(ticker: string) {
  return String(ticker || "").trim().toUpperCase().replace(/\.(SS|SZ)$/, "");
}

export function cnExchange(ticker: string) {
  const raw = String(ticker || "").trim().toUpperCase();
  return raw.endsWith(".SS") || cnCode(raw).startsWith("6") ? "SS" : "SZ";
}

export function cnTicker(ticker: string) {
  const code = cnCode(ticker);
  return `${code}.${cnExchange(ticker)}`;
}
