/**
 * market.js — the single place that knows which market a ticker belongs to and
 * how each data provider wants that ticker spelled. Echo covers HK + US + CN (A股).
 *
 *   detectMarket("0700.HK") → "HK"   detectMarket("AAPL") → "US"   detectMarket("600519.SS") → "CN"
 *
 * Rules: *.SS/*.SZ or bare 6-digit → CN; bare 1-5 digit or *.HK → HK; bare letters or *.US → US.
 * CN ticker suffix convention: .SS (Shanghai: 60x/601x/603x/605x/688x) / .SZ (Shenzhen: 0xx/002x/003x/300x/301x).
 */

export function detectMarket(ticker) {
  const t = String(ticker || "").trim().toUpperCase().replace(/\s+/g, "");
  if (/\.US$/.test(t)) return "US";
  if (/\.HK$/.test(t)) return "HK";
  if (/\.(SS|SZ)$/.test(t)) return "CN";
  if (/^\d{6}$/.test(t)) return "CN";
  if (/^\d{1,5}$/.test(t)) return "HK";
  if (/^[A-Z][A-Z.]{0,6}$/.test(t)) return "US";
  return "HK";
}

export function isUS(ticker) {
  return detectMarket(ticker) === "US";
}

export function isCN(ticker) {
  return detectMarket(ticker) === "CN";
}

/** Core symbol with any market suffix stripped: "0700.HK" → "0700", "AAPL.US" → "AAPL", "600519.SS" → "600519". */
export function bareSymbol(ticker) {
  return String(ticker || "").trim().toUpperCase().replace(/\.(HK|US|SS|SZ)$/i, "");
}

/** HK numeric code, zero-padded to 4: "700" → "0700". */
export function hkCode(ticker) {
  return bareSymbol(ticker).replace(/[^\d]/g, "").padStart(4, "0");
}

/** A股 6-digit code, validated as-is — must NOT zero-pad (unlike hkCode, CN codes are already fixed-width). */
export function cnCode(ticker) {
  return bareSymbol(ticker).replace(/[^\d]/g, "").slice(-6).padStart(6, "0");
}

/** Shanghai (SSE) vs Shenzhen (SZSE) from the leading digit(s) of a CN code. */
export function cnExchange(ticker) {
  const code = cnCode(ticker);
  return /^(60|68)/.test(code) ? "SS" : "SZ";
}

/** Normalized CN ticker with the correct exchange suffix inferred if missing: "600519" → "600519.SS". */
export function cnTicker(ticker) {
  return `${cnCode(ticker)}.${cnExchange(ticker)}`;
}

export function marketCurrency(ticker) {
  const m = detectMarket(ticker);
  if (m === "US") return "USD";
  if (m === "CN") return "CNY";
  return "HKD";
}

export function marketLabel(ticker) {
  const m = detectMarket(ticker);
  if (m === "US") return "美股";
  if (m === "CN") return "A股";
  return "港股";
}

// ── Per-provider symbol spelling ─────────────────────────
export function fmpSymbol(ticker) {
  const m = detectMarket(ticker);
  if (m === "US") return bareSymbol(ticker);
  if (m === "CN") return cnTicker(ticker);
  return `${hkCode(ticker)}.HK`;
}

export function finnhubSymbol(ticker) {
  const m = detectMarket(ticker);
  if (m === "US") return bareSymbol(ticker);
  if (m === "CN") return cnTicker(ticker);
  return `${hkCode(ticker)}.HK`;
}

export function yahooSymbol(ticker) {
  const m = detectMarket(ticker);
  if (m === "US") return bareSymbol(ticker);
  if (m === "CN") return cnTicker(ticker);
  return `${hkCode(ticker)}.HK`;
}

export function alphaVantageSymbol(ticker) {
  const m = detectMarket(ticker);
  if (m === "US") return bareSymbol(ticker);
  if (m === "CN") return cnTicker(ticker);
  return `${hkCode(ticker)}.HKG`;
}

export function twelveDataSymbol(ticker) {
  const m = detectMarket(ticker);
  if (m === "US") return bareSymbol(ticker);
  if (m === "CN") return cnTicker(ticker);
  return `${hkCode(ticker)}:HKEX`;
}

export function tencentSymbol(ticker) {
  const m = detectMarket(ticker);
  if (m === "US") return `us${bareSymbol(ticker)}`;
  if (m === "CN") return `${cnExchange(ticker) === "SS" ? "sh" : "sz"}${cnCode(ticker)}`;
  return `hk${hkCode(ticker).padStart(5, "0")}`;
}

/** Sina Finance symbol — CN-only provider (not used for HK/US today): "600519.SS" → "sh600519". */
export function sinaSymbol(ticker) {
  return `${cnExchange(ticker) === "SS" ? "sh" : "sz"}${cnCode(ticker)}`;
}

/** Eastmoney secid format — CN-only provider: SSE=1, SZSE=0, e.g. "600519.SS" → "1.600519". */
export function eastmoneySymbol(ticker) {
  return `${cnExchange(ticker) === "SS" ? "1" : "0"}.${cnCode(ticker)}`;
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
