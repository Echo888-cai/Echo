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
import { fetchJson as requestJson } from "./server/utils/http.js";

// Public project URL is a real, durable contact surface; never send a fabricated
// mailbox when the operator has not configured a private SEC contact address.
const SEC_UA = process.env.SEC_USER_AGENT || "EchoResearch/0.1 (+https://github.com/EchoResearchLab/Echo)";
// Forms worth surfacing: current reports, quarterly/annual, foreign-issuer equivalents.
const FORMS_OF_INTEREST = new Set(["8-K", "10-Q", "10-K", "10-K/A", "10-Q/A", "6-K", "20-F", "40-F", "8-K/A"]);

let tickerMapCache = null;
let tickerMapFetchedAt = 0;
const TICKER_MAP_TTL_MS = 24 * 60 * 60 * 1000;
const fetchJson = (url, timeoutMs = 8000) => requestJson(url, {
  timeoutMs,
  userAgent: SEC_UA,
  errorPreviewLength: 120
});

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

export async function tickerToCik(ticker) {
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

// ─── F-4a：内部人交易（SEC Form 4，美股先行） ────────────────────
//
// 真实调用验证过一个关键假设错误：Form 4 在 submissions.json 里指向的
// `xslF345X06/form4.xml` 路径返回的是 SEC 生成的可读 HTML（给人看的渲染版），
// 不是机器可读的原始 XML——真正的结构化数据在同一目录下不带 xsl 前缀的
// `form4.xml`。两者 URL 只差一段路径，容易踩坑，故记录在案。
//
// 只统计真实公开市场买卖（transactionCode P=买入、S=卖出），跳过期权行权（M）、
// 税务代扣（F）、授予/归属（A）、赠与（G）等薪酬性质变动——那些不是内部人对
// 公司价值的真实判断信号，混进"净买卖"会把每次 RSU 归属都算成"增持"，误导用户。

const MEANINGFUL_TRANSACTION_CODES = new Set(["P", "S"]);
const INSIDER_LOOKBACK_DAYS = 180;
const MAX_FORM4_FILINGS = 10; // 有界：避免单次研究触发过多顺序请求拖慢整体响应

/** 从一段 XML 块里取字段值——SEC Form 4 schema 里同名字段有的包一层 <value>，有的不包，两种都试。 */
function xmlField(block, tag) {
  const wrapped = block.match(new RegExp(`<${tag}>\\s*<value>([^<]*)</value>`, "i"));
  if (wrapped) return wrapped[1].trim();
  const direct = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"));
  return direct ? direct[1].trim() : "";
}

/**
 * 解析单份 Form 4 原始 XML（纯函数，不发网络请求）。只看非衍生品交易表
 * （nonDerivativeTable）——衍生品表是期权/RSU，不是真实股票买卖。
 * @returns {{ownerName: string, isOfficer: boolean, isDirector: boolean, transactions: Array<{date: string, code: string, shares: number|null, pricePerShare: number|null, acquiredDisposed: "A"|"D"|""}>}}
 */
export function parseForm4Xml(xml = "") {
  const text = String(xml || "");
  const ownerName = (text.match(/<rptOwnerName>([^<]*)<\/rptOwnerName>/i) || [])[1]?.trim() || "";
  const isOfficer = /<isOfficer>\s*(?:<value>)?\s*1|true/i.test(text.match(/<isOfficer>[\s\S]*?<\/isOfficer>/i)?.[0] || "");
  const isDirector = /<isDirector>\s*(?:<value>)?\s*1|true/i.test(text.match(/<isDirector>[\s\S]*?<\/isDirector>/i)?.[0] || "");

  const blocks = [...text.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)].map((m) => m[1]);
  const transactions = blocks.map((block) => {
    const shares = xmlField(block, "transactionShares");
    const price = xmlField(block, "transactionPricePerShare");
    return {
      date: xmlField(block, "transactionDate"),
      code: xmlField(block, "transactionCode"),
      shares: shares ? Number(shares) : null,
      pricePerShare: price && Number.isFinite(Number(price)) ? Number(price) : null,
      acquiredDisposed: xmlField(block, "transactionAcquiredDisposedCode")
    };
  }).filter((t) => Number.isFinite(t.shares) && t.shares > 0);

  return { ownerName, isOfficer, isDirector, transactions };
}

/**
 * 聚合多份已解析的 Form 4 文件（纯函数）：只统计 P/S 两种有真实信号的交易码。
 * @param {Array<{ownerName: string, transactions: Array}>} filings
 */
export function aggregateInsiderTransactions(filings = []) {
  let netShares = 0;
  let netValueUsd = 0;
  let buyCount = 0;
  let sellCount = 0;
  let lastTransactionAt = null;
  const insiders = new Set();
  const rows = [];

  for (const filing of filings) {
    for (const t of filing.transactions || []) {
      if (!MEANINGFUL_TRANSACTION_CODES.has(t.code)) continue;
      const sign = t.acquiredDisposed === "A" ? 1 : t.acquiredDisposed === "D" ? -1 : 0;
      if (sign === 0) continue;
      netShares += sign * t.shares;
      if (t.pricePerShare != null) netValueUsd += sign * t.shares * t.pricePerShare;
      if (sign > 0) buyCount += 1; else sellCount += 1;
      insiders.add(filing.ownerName);
      if (!lastTransactionAt || t.date > lastTransactionAt) lastTransactionAt = t.date;
      rows.push({ ownerName: filing.ownerName, date: t.date, code: t.code, shares: t.shares, pricePerShare: t.pricePerShare, acquiredDisposed: t.acquiredDisposed });
    }
  }
  rows.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return {
    netShares,
    netValueUsd: Math.round(netValueUsd),
    buyCount,
    sellCount,
    distinctInsiders: insiders.size,
    lastTransactionAt,
    transactions: rows.slice(0, 10)
  };
}

/**
 * 真实抓取：该 ticker 近 180 天内最多 10 份 Form 4，解析后聚合净买卖。
 * 顺序请求（不是并发）——SEC 建议的 fair-use 速率友好写法；一份 Form 4 失败
 * 不影响其它份的解析。
 * @returns {Promise<{providerStatus: "ok"|"missing", netShares, netValueUsd, buyCount, sellCount, distinctInsiders, lastTransactionAt, transactions, detail: string|null}>}
 */
export async function fetchInsiderActivity(ticker) {
  const cik = await tickerToCik(ticker);
  const cikNum = String(cik).replace(/^0+/, "");
  const json = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, 9000);
  const recent = json?.filings?.recent;
  if (!recent || !Array.isArray(recent.form)) throw new Error("SEC EDGAR 没有返回 filings.recent");

  const cutoff = new Date(Date.now() - INSIDER_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const candidates = [];
  for (let i = 0; i < recent.form.length && candidates.length < MAX_FORM4_FILINGS; i++) {
    if (recent.form[i] !== "4") continue;
    const filingDate = recent.filingDate?.[i] || "";
    if (filingDate < cutoff) continue;
    const accession = (recent.accessionNumber?.[i] || "").replace(/-/g, "");
    if (!accession) continue;
    candidates.push(`https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession}/form4.xml`);
  }
  if (!candidates.length) {
    return { providerStatus: "missing", netShares: 0, netValueUsd: 0, buyCount: 0, sellCount: 0, distinctInsiders: 0, lastTransactionAt: null, transactions: [], detail: `近 ${INSIDER_LOOKBACK_DAYS} 天没有 Form 4 备案` };
  }

  const filings = [];
  for (const url of candidates) {
    try {
      const xml = await fetchTextSec(url, 8000);
      filings.push(parseForm4Xml(xml));
    } catch { /* 单份失败不影响其它份 */ }
  }
  const summary = aggregateInsiderTransactions(filings);
  return { providerStatus: "ok", ...summary, detail: null };
}
