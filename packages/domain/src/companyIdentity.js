/**
 * Pure security boundary for ticker-like tokens in natural-language questions.
 *
 * Numbers are especially dangerous in an investment product: a cost basis,
 * share count or valuation threshold must never silently become a HK ticker.
 * Keep these rules deterministic; provider-backed verification happens later.
 */

const MONEY_OR_QUANTITY_SUFFIX = /^\s*(?:块钱?|元|美元|美金|港元|港币|人民币|股|手|万|亿|%|％|倍|年|个月|月|天|日|个基点|基点|个百分点|个点|bp)/i;
// 价格类前缀与数字之间常常隔着一个动词（"止损价**设** 320"、"目标价**看到** 450"），
// 之前要求前缀紧贴数字（`\s*$`），于是"止损价设 320 合适吗"里的 320 被当成 0320.HK。
// 允许中间夹最多 4 个非数字字符，把动词放进来，但不至于跨过整个从句。
const MONEY_OR_QUANTITY_PREFIX =
  /(?:成本价?|买入价?|购入价?|入仓价?|现价|价格|目标价|止损价?|止盈价?|市值|持有|买了|买的|买入|购入|入手|跌到|涨到|回撤到)\s*[^\d]{0,4}$/i;

/** 全角数字/字母/标点 → 半角。中文输入法下 "０７００.ＨＫ" 是很常见的输入，
 *  没有这一步它连一个候选都匹配不到，用户只会觉得"这破东西连代码都认不出"。
 *  全角区 U+FF01–U+FF5E 与半角区固定相差 0xFEE0；U+3000 是全角空格。 */
function toHalfWidth(text) {
  return String(text)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, " ");
}

/** 零宽字符：从网页/IM 复制股票代码时经常被夹带进来，肉眼完全不可见，
 *  但会让 "腾<ZWSP>讯" 匹配不上 /腾讯/。清掉它们不改变任何用户可见的语义。
 *  用转义而不是字面量：这些字符在源码里同样不可见，谁也 review 不出来改动对不对。
 *  U+200B–U+200F 零宽/方向标记，U+2060 word joiner，U+FEFF BOM。 */
function stripInvisible(text) {
  return String(text).replace(/[\u200B-\u200F\u2060\uFEFF]/g, "");
}

/**
 * 实体抽取前的输入归一化。**所有**实体抽取入口都必须先过这里，否则同一个问题
 * 在不同层会得到不同结论（前端认出来了、后端没认出来，或者反过来）。
 */
export function normalizeQuestionText(text = "") {
  return toHalfWidth(stripInvisible(String(text)));
}

function normalizeHkDigits(digits) {
  return `${digits.padStart(4, "0")}.HK`;
}

/**
 * Extract a HK ticker without treating ordinary investment numbers as tickers.
 * Explicit market notation always wins; implicit notation requires 3–5 digits
 * and is rejected beside money, quantity, ratio or time language.
 */
export function extractHkTicker(text = "") {
  const raw = normalizeQuestionText(text);

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

/**
 * 不能当美股代码看的常见缩写。**这是唯一一份**——前端 `apps/web/src/lib/resolve.ts`
 * 曾经手抄了一份副本，两份必然漂移：实测 SPY 在两边都有、QQQ 两边都没有，于是
 * "SPY 和 QQQ 有什么区别" 会把 QQQ 抽成研究标的。副本已删，前端改为 import 这里。
 *
 * 宽基 ETF 单列一组：它们是"市场"不是"公司"，问它们不是公司研究（宏观路由另有处理）。
 */
const COMMON_NON_TICKERS = new Set([
  "PE", "PB", "PS", "ROE", "ROI", "ROA", "ROC", "AI", "IPO", "GDP", "CEO",
  "CFO", "COO", "CTO", "CMO", "US", "HK", "EPS", "FCF", "DCF", "ETF", "ADR",
  "Q1", "Q2", "Q3", "Q4", "YOY", "QOQ", "MOM", "TTM", "LTM", "MRQ",
  "CPI", "PPI", "PMI", "GNP", "EV", "NAV", "AUM", "BPS", "DPS", "NIM",
  "NYSE", "SEC", "SFC", "MSCI", "FTSE", "ESG", "SPAC",
  // 宽基指数与 ETF（"大盘"的同义词，不是研究标的）
  "SPX", "SPY", "QQQ", "DIA", "IWM", "VOO", "VTI", "VT", "IVV", "ARKK", "HSI", "EEM", "FXI", "KWEB",
  "WHAT", "ABOUT", "HOW", "THE", "FOR", "AND", "BUY", "SELL", "PRICE", "STOCK"
]);

/** 前端的解析层需要同一份停用词。导出的是拷贝，避免调用方改到领域包内部状态。 */
export function commonNonTickers() {
  return new Set(COMMON_NON_TICKERS);
}

/**
 * Extract a US ticker token. Lowercase tokens are accepted only in CJK text,
 * which supports natural questions such as “86块钱的rklb怎么样” without turning
 * arbitrary English prose into ticker guesses. The result still requires a
 * provider-backed listing verification before research starts.
 */
export function extractUsTickerToken(text = "", additionalStopwords = []) {
  const raw = normalizeQuestionText(text).trim();
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
