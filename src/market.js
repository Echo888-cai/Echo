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

// 港股 → 美股 ADR 映射（主流双重上市名，非穷举）。Finnhub 免费档很多端点（财报日历、
// 同业清单）不支持直查港股，但支持查它的美股 ADR——两处消费方（G-2 财报日历、G-3 同业
// 发现）共用这一张表，避免各自维护出现漂移。没有映射的港股：两处都诚实返回缺失，不猜。
export const HK_ADR_MAP = {
  "0700": "TCEHY", // 腾讯
  "9988": "BABA",  // 阿里巴巴
  "9868": "XPEV",  // 小鹏汽车
  "9866": "LI",    // 理想汽车
  "9863": "ZK",    // 极氪
  "9999": "NTES",  // 网易
  "9618": "JD",    // 京东
  "9626": "BILI",  // 哔哩哔哩
  "9961": "TCOM",  // 携程
  "9888": "BIDU"   // 百度
};

/** 该 ticker 对应的美股 ADR symbol；美股直接返回自身 bare symbol，港股无映射返回 null。 */
export function adrOrBareSymbol(ticker) {
  if (isUS(ticker)) return bareSymbol(ticker);
  return HK_ADR_MAP[hkCode(ticker)] || null;
}
