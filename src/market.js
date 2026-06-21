/**
 * market.js — the single place that knows which market a ticker belongs to and
 * how each data provider wants that ticker spelled. Luvio covers HK + US.
 *
 *   detectMarket("0700.HK") → "HK"   detectMarket("AAPL") → "US"
 *
 * Rules: bare digits or *.HK → HK; bare letters or *.US → US.
 */

export function detectMarket(ticker) {
  const t = String(ticker || "").trim().toUpperCase().replace(/\s+/g, "");
  if (/\.US$/.test(t)) return "US";
  if (/\.HK$/.test(t)) return "HK";
  if (/^\d{1,5}$/.test(t)) return "HK";
  if (/^[A-Z][A-Z.]{0,6}$/.test(t)) return "US";
  return "HK";
}

export function isUS(ticker) {
  return detectMarket(ticker) === "US";
}

/** Core symbol with any market suffix stripped: "0700.HK" → "0700", "AAPL.US" → "AAPL". */
export function bareSymbol(ticker) {
  return String(ticker || "").trim().toUpperCase().replace(/\.(HK|US)$/i, "");
}

/** HK numeric code, zero-padded to 4: "700" → "0700". */
export function hkCode(ticker) {
  return bareSymbol(ticker).replace(/[^\d]/g, "").padStart(4, "0");
}

export function marketCurrency(ticker) {
  return isUS(ticker) ? "USD" : "HKD";
}

export function marketLabel(ticker) {
  return isUS(ticker) ? "美股" : "港股";
}

// ── Per-provider symbol spelling ─────────────────────────
export function fmpSymbol(ticker) {
  return isUS(ticker) ? bareSymbol(ticker) : `${hkCode(ticker)}.HK`;
}

export function finnhubSymbol(ticker) {
  return isUS(ticker) ? bareSymbol(ticker) : `${hkCode(ticker)}.HK`;
}

export function yahooSymbol(ticker) {
  return isUS(ticker) ? bareSymbol(ticker) : `${hkCode(ticker)}.HK`;
}

export function alphaVantageSymbol(ticker) {
  return isUS(ticker) ? bareSymbol(ticker) : `${hkCode(ticker)}.HKG`;
}

export function twelveDataSymbol(ticker) {
  return isUS(ticker) ? bareSymbol(ticker) : `${hkCode(ticker)}:HKEX`;
}

export function tencentSymbol(ticker) {
  return isUS(ticker) ? `us${bareSymbol(ticker)}` : `hk${hkCode(ticker).padStart(5, "0")}`;
}
