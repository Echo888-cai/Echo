/**
 * secFilings — US primary-filing adapter (SEC EDGAR). Free, no API key; SEC only
 * asks for a descriptive User-Agent. This is the US counterpart to filingData.js's
 * HKEX path: latest 8-K / 10-Q / 10-K so the agent can anchor on real events.
 *
 *   getUsFilings("AAPL") → { providerStatus, source, filings:[{title,filingType,publishedAt,url}], ... }
 *
 * Parsing is split into pure functions (parseSecSubmissions) so it is unit-testable
 * without network.
 */

import { bareSymbol } from "./market.js";
import { normalizeTicker } from "./data.js";

const SEC_UA = process.env.SEC_USER_AGENT || "Luvio Research research@luvio.app";
// Forms worth surfacing: current reports, quarterly/annual, foreign-issuer equivalents.
const FORMS_OF_INTEREST = new Set(["8-K", "10-Q", "10-K", "10-K/A", "10-Q/A", "6-K", "20-F", "40-F", "8-K/A"]);

let tickerMapCache = null;
let tickerMapFetchedAt = 0;
const TICKER_MAP_TTL_MS = 24 * 60 * 60 * 1000;

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": SEC_UA, Accept: "application/json" }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 120)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/** Build a { TICKER → 10-digit CIK } lookup from SEC's company_tickers.json (pure). */
export function buildTickerCikMap(raw) {
  const map = {};
  const rows = raw && typeof raw === "object" ? Object.values(raw) : [];
  for (const row of rows) {
    if (!row?.ticker || row.cik_str == null) continue;
    map[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, "0");
  }
  return map;
}

async function tickerToCik(ticker) {
  const symbol = bareSymbol(ticker).toUpperCase();
  const fresh = tickerMapCache && Date.now() - tickerMapFetchedAt < TICKER_MAP_TTL_MS;
  if (!fresh) {
    const raw = await fetchJson("https://www.sec.gov/files/company_tickers.json", 9000);
    tickerMapCache = buildTickerCikMap(raw);
    tickerMapFetchedAt = Date.now();
  }
  const cik = tickerMapCache[symbol];
  if (!cik) throw new Error(`SEC 没有匹配到 ${symbol} 的 CIK`);
  return cik;
}

/**
 * Turn an EDGAR submissions payload into a clean filings list (pure).
 * @param {object} json   - the data.sec.gov submissions JSON
 * @param {string} cik    - 10-digit CIK (used to build the document URL)
 * @param {number} limit  - max filings to return
 */
export function parseSecSubmissions(json, cik, limit = 12) {
  const recent = json?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) return [];
  const cikNum = String(cik).replace(/^0+/, "");
  const out = [];
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i];
    if (!FORMS_OF_INTEREST.has(form)) continue;
    const accession = recent.accessionNumber?.[i] || "";
    const accessionNoDash = accession.replace(/-/g, "");
    const primaryDoc = recent.primaryDocument?.[i] || "";
    const desc = recent.primaryDocDescription?.[i] || recent.items?.[i] || "";
    const url = accessionNoDash && primaryDoc
      ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accessionNoDash}/${primaryDoc}`
      : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${encodeURIComponent(form)}`;
    out.push({
      title: desc ? `${form} · ${String(desc).slice(0, 80)}` : form,
      filingType: form,
      publishedAt: recent.filingDate?.[i] || "",
      url,
      source: "SEC EDGAR"
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function getUsFilings(ticker) {
  try {
    const cik = await tickerToCik(ticker);
    const json = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, 9000);
    const filings = parseSecSubmissions(json, cik);
    if (!filings.length) throw new Error("SEC EDGAR 没有返回目标表格");
    return {
      ticker: normalizeTicker(ticker),
      providerStatus: "ok",
      source: "SEC EDGAR",
      filings,
      asOf: new Date().toISOString(),
      errors: []
    };
  } catch (error) {
    return {
      ticker: normalizeTicker(ticker),
      providerStatus: "missing",
      source: "未接入",
      filings: [],
      asOf: new Date().toISOString(),
      errors: [error.message]
    };
  }
}

// ─── 8-K 结构化抽取（P7：与港股公告管道同思路——一手原文进事实块） ────

// 常见 8-K item 的中文标注，帮模型快速定位事件性质。
const EIGHT_K_ITEM_NAMES = {
  "1.01": "签订重大最终协议",
  "1.02": "重大协议终止",
  "2.01": "完成收购或资产出售",
  "2.02": "业绩与经营结果",
  "2.03": "产生重大债务义务",
  "2.05": "重组/裁员成本",
  "2.06": "重大减值",
  "3.01": "退市或不满足上市标准通知",
  "4.01": "更换审计师",
  "4.02": "以往财报不可依赖",
  "5.02": "董事/高管变动或薪酬安排",
  "5.03": "章程或财年变更",
  "5.07": "股东投票结果",
  "7.01": "Reg FD 自愿披露",
  "8.01": "其他重大事件",
  "9.01": "财务报表及附件"
};

/** 8-K 原文 HTML → 纯文本（去 script/style/tag/实体，压空白）。 */
export function htmlToText(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&#82(20|21);|&[lr]dquo;/gi, '"')
    .replace(/&[a-z]+\d*;|&#\d+;/gi, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * 8-K 纯文本 → 结构化 item 列表（纯函数）。
 * 返回 [{ code, name, excerpt }]；同一 item 出现多次（目录+正文）取正文（更长的那段）。
 */
export function parse8KItems(text = "") {
  const matches = [...String(text).matchAll(/\bItem\s+(\d+\.\d{2})\.?\s*/gi)];
  const byCode = new Map();
  for (let i = 0; i < matches.length; i++) {
    const code = matches[i][1];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : Math.min(start + 600, text.length);
    const body = text.slice(start, end).replace(/\s+/g, " ").trim();
    const existing = byCode.get(code);
    if (!existing || body.length > existing.rawLength) {
      byCode.set(code, {
        code,
        name: EIGHT_K_ITEM_NAMES[code] || "",
        excerpt: body.slice(0, 400),
        rawLength: body.length
      });
    }
  }
  return [...byCode.values()]
    .filter((item) => item.rawLength > 20) // 目录式裸引用（无正文）过滤掉
    .map(({ code, name, excerpt }) => ({ code, name, excerpt }));
}

async function fetchTextSec(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": SEC_UA, Accept: "text/html,*/*" }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 120)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 对已取得的美股公告列表做 8-K 增强：抓最近 1-2 份 8-K 原文，抽 item 结构。
 * 输入是 getUsFilings/getRecentFilings 的结果（不重复打 submissions 接口）。
 */
export async function enrich8K(filingsData, { limit = 2 } = {}) {
  const eightKs = (filingsData?.filings || []).filter((f) => /^8-K/.test(f.filingType)).slice(0, limit);
  if (!eightKs.length) return { providerStatus: "missing", filings: [], errors: ["没有可用的 8-K"] };
  const out = [];
  const errors = [];
  for (const filing of eightKs) {
    try {
      const html = await fetchTextSec(filing.url, 8000);
      const items = parse8KItems(htmlToText(html));
      if (items.length) {
        out.push({ publishedAt: filing.publishedAt, url: filing.url, items });
      }
    } catch (error) {
      errors.push(`${filing.publishedAt} 8-K: ${error.message}`);
    }
  }
  return {
    providerStatus: out.length ? "ok" : "missing",
    source: "SEC EDGAR 8-K 原文",
    filings: out,
    errors,
    asOf: new Date().toISOString()
  };
}

export function _resetSecCache() {
  tickerMapCache = null;
  tickerMapFetchedAt = 0;
}
