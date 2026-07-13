/**
 * Pure security boundary for ticker-like tokens in natural-language questions.
 *
 * Numbers are especially dangerous in an investment product: a cost basis,
 * share count or valuation threshold must never silently become a HK ticker.
 * Keep these rules deterministic; provider-backed verification happens later.
 */

const MONEY_OR_QUANTITY_SUFFIX = /^\s*(?:块钱?|元|美元|美金|港元|港币|人民币|股|手|万|亿|%|％|倍|年|个月|月|天|日)/i;
const MONEY_OR_QUANTITY_PREFIX = /(?:成本价?|买入价?|购入价?|入仓价?|现价|价格|目标价|止损价?|止盈价?|市值|持有|买了|买的|买入|购入|入手)\s*$/i;

function normalizeHkDigits(digits) {
  return `${digits.padStart(4, "0")}.HK`;
}

/**
 * Extract a HK ticker without treating ordinary investment numbers as tickers.
 * Explicit market notation always wins; implicit notation requires 3–5 digits
 * and is rejected beside money, quantity, ratio or time language.
 */
export function extractHkTicker(text = "") {
  const raw = String(text);

  const explicitSuffix = raw.match(/(?:^|[^\dA-Za-z])(\d{1,5})\s*(?:\.\s*)?HK(?![A-Za-z])/i);
  if (explicitSuffix) return normalizeHkDigits(explicitSuffix[1]);

  const explicitPrefix = raw.match(/(?:港股|股票代码|证券代码|代码)\s*[:：]?\s*(\d{1,5})(?!\d)/i);
  if (explicitPrefix) return normalizeHkDigits(explicitPrefix[1]);

  const onlyNumber = raw.trim().match(/^(\d{1,5})$/);
  if (onlyNumber) return normalizeHkDigits(onlyNumber[1]);

  for (const match of raw.matchAll(/(?<![\d.])(\d{3,5})(?![\d.])/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = raw.slice(Math.max(0, start - 12), start);
    const after = raw.slice(end, end + 12);
    if (MONEY_OR_QUANTITY_PREFIX.test(before) || MONEY_OR_QUANTITY_SUFFIX.test(after)) continue;
    return normalizeHkDigits(match[1]);
  }
  return "";
}

const COMMON_NON_TICKERS = new Set([
  "PE", "PB", "PS", "ROE", "ROI", "ROA", "ROC", "AI", "IPO", "GDP", "CEO",
  "CFO", "COO", "CTO", "CMO", "US", "HK", "EPS", "FCF", "DCF", "ETF",
  "Q1", "Q2", "Q3", "Q4", "YOY", "QOQ", "MOM", "TTM", "LTM", "MRQ",
  "CPI", "PPI", "PMI", "GNP", "EV", "NAV", "AUM", "BPS", "DPS", "NIM",
  "NYSE", "SEC", "SFC", "MSCI", "FTSE", "SPX", "SPY", "ESG", "SPAC",
  "WHAT", "ABOUT", "HOW", "THE", "FOR", "AND", "BUY", "SELL", "PRICE", "STOCK"
]);

/**
 * Extract a US ticker token. Lowercase tokens are accepted only in CJK text,
 * which supports natural questions such as “86块钱的rklb怎么样” without turning
 * arbitrary English prose into ticker guesses. The result still requires a
 * provider-backed listing verification before research starts.
 */
export function extractUsTickerToken(text = "", additionalStopwords = []) {
  const raw = String(text).trim();
  const stopwords = new Set([...COMMON_NON_TICKERS, ...additionalStopwords].map((word) => String(word).toUpperCase()));

  const explicit = raw.match(/\$([A-Za-z][A-Za-z.-]{0,6})\b/) || raw.match(/\b([A-Za-z][A-Za-z.-]{0,6})\.US\b/i);
  if (explicit) {
    const ticker = explicit[1].toUpperCase();
    return stopwords.has(ticker) ? "" : ticker;
  }

  if (/^[A-Za-z][A-Za-z.-]{0,6}$/.test(raw)) {
    const ticker = raw.toUpperCase();
    return stopwords.has(ticker) ? "" : ticker;
  }

  const hasCjk = /[\u3400-\u9fff]/u.test(raw);
  const candidates = [...raw.matchAll(/[A-Za-z][A-Za-z.-]{1,6}/g)]
    .filter((match) => match[0].length <= 5)
    // “OPEN AI / SPACE X” 是多词公司名，不把第一个词误作裸 ticker。
    .filter((match) => !/^\s+[A-Za-z]/.test(raw.slice((match.index ?? 0) + match[0].length)))
    .map((match) => match[0])
    // 中文问句接受小写代码；全英文句只接受全大写，或长度 ≥4 的末尾小写代码。
    // 这样支持 “what about rklb”，同时不把 “rocket lab” 的 lab 误判成 LAB。
    .filter((token) => token === token.toUpperCase() || (token === token.toLowerCase() && (hasCjk || token.length >= 4)))
    .map((token) => token.toUpperCase())
    .filter((token) => !stopwords.has(token));
  return candidates.at(-1) || "";
}
