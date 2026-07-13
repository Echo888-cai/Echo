/**
 * hkFilingsPipeline — 港股一手数据管道（P7）。
 *
 * HKEX 披露易业绩公告列表（titleSearchServlet）→ 业绩公告 PDF 下载（.cache/filings/）
 * → scripts/extract_pdf_text.py 抽文本（pdfminer 优先，行按 Y 坐标重组）
 * → 解析三表关键行（收入/毛利/经营盈利/期内盈利/EPS/经营现金流/现金）
 * → hk_financials 表（绝对币值 + 来源公告 PDF URL）。
 *
 * 解析全部是导出的纯函数（parseHkexSearchResult / parsePeriodFromTitle /
 * parseResultsText），无网络即可单测。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTicker } from "../../../../src/data.js";
import { isUS } from "../../../../src/market.js";
import { upsertHkFinancials, hasHkFinancialsForUrl, upsertHkFilingIngestLog } from "../../../../src/server/repositories/hkFinancialsRepository.js";
import { addDocument } from "../../../../src/server/repositories/documentRepository.js";
import { upsertHkBuyback, hasHkBuybackForUrl } from "../../../../src/server/repositories/hkBuybackRepository.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(here, "..", "..", "..", "..");
const EXTRACT_SCRIPT = join(PROJECT_ROOT, "scripts", "extract_pdf_text.py");
const CACHE_DIR = join(PROJECT_ROOT, ".cache", "filings");

const HKEX_BASE = "https://www1.hkexnews.hk";
const stockIdCache = new Map();

// ─── HKEX 搜索 ───────────────────────────────────────────────────────

async function fetchText(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 EchoResearch/0.1 HKEX filings pipeline", Accept: "*/*" }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 120)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ticker → HKEX 内部 stockId（G-1.5：导出供 filingData.js 的通用公告列表复用，
 * 不再各自维护一套 stockId 查找逻辑）。
 */
export async function lookupStockId(ticker) {
  const code = normalizeTicker(ticker).replace(".HK", "");
  if (stockIdCache.has(code)) return stockIdCache.get(code);
  const text = await fetchText(
    `${HKEX_BASE}/search/prefix.do?callback=cb&lang=ZH&type=A&name=${encodeURIComponent(code)}&market=SEHK`,
    8000
  );
  const json = JSON.parse(text.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, ""));
  const stockId = json?.stockInfo?.[0]?.stockId;
  if (stockId == null) throw new Error(`HKEX 披露易没有匹配到 ${code} 的 stockId`);
  stockIdCache.set(code, stockId);
  return stockId;
}

function decodeHtmlEntities(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** "13/05/2026 16:31" → "2026-05-13T16:31:00"（HKEX 本地时间，仅用于排序/展示）。 */
function parseHkexDateTime(raw = "") {
  const m = String(raw).match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}${m[4] ? `T${m[4]}:${m[5]}:00` : ""}`;
}

// 澄清/更正/补充/翌日披露等衍生公告不含完整三表，直接排除。
const NOISE_TITLE = /澄清|更正|補充|补充|取消|延遲|延迟|翌日|議程|议程|通函|代表委任/;

/**
 * titleSearchServlet 响应 → 业绩公告清单（纯函数）。
 * @param {object} raw - { result: "<json string>" } 或 { result: [...] }
 */
export function parseHkexSearchResult(raw) {
  let rows = [];
  if (typeof raw?.result === "string") {
    try { rows = JSON.parse(raw.result); } catch { rows = []; }
  } else if (Array.isArray(raw?.result)) {
    rows = raw.result;
  }
  return rows
    .map((r) => ({
      title: decodeHtmlEntities(r.TITLE || ""),
      filingType: decodeHtmlEntities(r.LONG_TEXT || r.SHORT_TEXT || ""),
      fileType: r.FILE_TYPE || "",
      size: r.FILE_INFO || "",
      newsId: r.NEWS_ID || "",
      publishedAt: parseHkexDateTime(r.DATE_TIME),
      url: r.FILE_LINK ? (r.FILE_LINK.startsWith("http") ? r.FILE_LINK : `${HKEX_BASE}${r.FILE_LINK}`) : ""
    }))
    .filter((r) => r.url && /PDF/i.test(r.fileType))
    .filter((r) => /業績|业绩|RESULTS ANNOUNCEMENT/i.test(r.title) && !NOISE_TITLE.test(r.title))
    .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}

/**
 * titleSearchServlet 响应 → 全类型公告清单（纯函数，G-1.5）。
 * 与 parseHkexSearchResult 的区别：不限 PDF 文件类型、不限"业绩"标题——这是给
 * filingData.js 的通用"公告数据"模块用的，需要看到全部披露（翌日披露表/股权变动/
 * 公告通函等），而不只是业绩公告。只要求有可点击的 URL。
 */
export function parseGeneralAnnouncements(raw) {
  let rows = [];
  if (typeof raw?.result === "string") {
    try { rows = JSON.parse(raw.result); } catch { rows = []; }
  } else if (Array.isArray(raw?.result)) {
    rows = raw.result;
  }
  return rows
    .map((r) => ({
      title: decodeHtmlEntities(r.TITLE || ""),
      filingType: decodeHtmlEntities(r.LONG_TEXT || r.SHORT_TEXT || ""),
      publishedAt: parseHkexDateTime(r.DATE_TIME),
      url: r.FILE_LINK ? (r.FILE_LINK.startsWith("http") ? r.FILE_LINK : `${HKEX_BASE}${r.FILE_LINK}`) : ""
    }))
    .filter((r) => r.url)
    .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}

/**
 * 最近一年全类型公告（新→旧），供 filingData.js 的 getRecentFilings 使用（G-1.5）。
 * 复用与 searchHkexResultsAnnouncements 相同的真实 titleSearchServlet 端点——此前
 * filingData.js 自己另开了一条路（HTML 抓取一个 JS 渲染的页面壳 + Bing 兜底），
 * 那条路永远拿不到数据，属于"看起来有降级路径、实际上永久 missing"的隐藏 bug。
 */
export async function searchHkexAllAnnouncements(ticker, { rowRange = 30, yearsBack = 1 } = {}) {
  const stockId = await lookupStockId(ticker);
  const now = new Date();
  const to = now.toISOString().slice(0, 10).replace(/-/g, "");
  const from = `${now.getFullYear() - yearsBack}0101`;
  const url =
    `${HKEX_BASE}/search/titleSearchServlet.do?sortDir=0&sortByOptions=DateTime&category=0&market=SEHK` +
    `&stockId=${stockId}&documentType=-1&fromDate=${from}&toDate=${to}` +
    `&title=&searchType=1&t1code=-2&t2Gcode=-2&t2code=-2&rowRange=${rowRange}&lang=zh`;
  const raw = JSON.parse(await fetchText(url, 12000));
  return parseGeneralAnnouncements(raw);
}

/** 最近两年的业绩公告列表（新→旧）。 */
export async function searchHkexResultsAnnouncements(ticker) {
  const stockId = await lookupStockId(ticker);
  const now = new Date();
  const to = now.toISOString().slice(0, 10).replace(/-/g, "");
  const from = `${now.getFullYear() - 2}0101`;
  const url =
    `${HKEX_BASE}/search/titleSearchServlet.do?sortDir=0&sortByOptions=DateTime&category=0&market=SEHK` +
    `&stockId=${stockId}&documentType=-1&fromDate=${from}&toDate=${to}` +
    `&title=${encodeURIComponent("業績")}&searchType=1&t1code=-2&t2Gcode=-2&t2code=-2&rowRange=100&lang=zh`;
  const raw = JSON.parse(await fetchText(url, 12000));
  return parseHkexSearchResult(raw);
}

/**
 * 最近 N 天的"翌日披露报表——已发行股份变动及股份购回"公告列表（新→旧），F-4b。
 * 复用与业绩公告相同的 titleSearchServlet 通道，标题关键词"購回"——真实调用验证过
 * （0700.HK 近一年 113 条），这类公告频率远高于业绩公告（每次实际购回后一个交易日内
 * 就要披露），rowRange 给足余量。
 */
export async function searchHkexBuybackAnnouncements(ticker, { daysBack = 180, rowRange = 60 } = {}) {
  const stockId = await lookupStockId(ticker);
  const now = new Date();
  const to = now.toISOString().slice(0, 10).replace(/-/g, "");
  const from = new Date(now.getTime() - daysBack * 24 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  const url =
    `${HKEX_BASE}/search/titleSearchServlet.do?sortDir=0&sortByOptions=DateTime&category=0&market=SEHK` +
    `&stockId=${stockId}&documentType=-1&fromDate=${from}&toDate=${to}` +
    `&title=${encodeURIComponent("購回")}&searchType=1&t1code=-2&t2Gcode=-2&t2code=-2&rowRange=${rowRange}&lang=zh`;
  const raw = JSON.parse(await fetchText(url, 12000));
  return parseGeneralAnnouncements(raw);
}

// ─── 期间解析 ────────────────────────────────────────────────────────

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function cnYear(text) {
  const digits = [...text].map((ch) => CN_DIGIT[ch]).filter((d) => d !== undefined);
  return digits.length === 4 ? Number(digits.join("")) : null;
}

function cnNumber(text) {
  if (/^\d+$/.test(text)) return Number(text);
  let value;
  const tenSplit = text.split("十");
  if (tenSplit.length === 2) {
    value = (tenSplit[0] ? CN_DIGIT[tenSplit[0]] ?? 1 : 1) * 10 + (tenSplit[1] ? CN_DIGIT[tenSplit[1]] ?? 0 : 0);
  } else {
    value = CN_DIGIT[text] ?? null;
  }
  return Number.isFinite(value) ? value : null;
}

const Q_END = { 1: [3, 31], 2: [6, 30], 3: [9, 30], 4: [12, 31] };

/**
 * 公告标题 → { periodEnd, periodType, periodLabel }（纯函数）。
 * "截至二零二六年三月三十一日止三個月業績公佈" → { periodEnd:"2026-03-31", periodType:"Q1", … }
 * 覆盖：年度/三個月(Qn)/六個月(H1)/九個月(9M)，中文或阿拉伯数字日期。
 * B-6：新增无"截至…止…日"从句的标题（如小鵬"XX發佈2025年第四季度及2025財政年度的未經
 * 審計財務業績"）——直接从"YYYY年第N季度"推季末日。
 */
export function parsePeriodFromTitle(title = "") {
  let year = null, month = null, day = null;
  const cn = title.match(/截至\s*([零〇一二三四五六七八九]{4})\s*年\s*([零〇一二三四五六七八九十]{1,3})\s*月\s*([零〇一二三四五六七八九十]{1,3})\s*日/);
  const monthEnd = title.match(/(\d{4})\s*年\s*([零〇一二三四五六七八九十]{1,3}|\d{1,2})\s*月底止/); // 阿里式 "2026年三月底止季度"
  const dq = title.match(/(\d{4})\s*年\s*第([一二三四])\s*季度/); // 小鵬式 "2025年第四季度"（无"截至…止…日"从句）
  if (cn) {
    year = cnYear(cn[1]);
    month = cnNumber(cn[2]);
    day = cnNumber(cn[3]);
  } else if (monthEnd) {
    year = Number(monthEnd[1]);
    month = cnNumber(monthEnd[2]);
    if (month) day = new Date(year, month, 0).getDate(); // 该月最后一天
  } else {
    const ar = title.match(/截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    // 简体裸标题（如汇丰"2025年業績"）：没有"截至…止…日"从句、也不提季度/半年度，
    // 港交所惯例下这类裸标题一律是年度业绩公告，按该年 12/31 处理。
    const bareYear = title.match(/^(\d{4})\s*年\s*(業績|业绩)(公告|公佈)?$/);
    if (ar) {
      year = Number(ar[1]); month = Number(ar[2]); day = Number(ar[3]);
    } else if (dq) {
      year = Number(dq[1]);
      const qn = CN_DIGIT[dq[2]];
      if (Q_END[qn]) { [month, day] = Q_END[qn]; }
    } else if (bareYear) {
      year = Number(bareYear[1]); month = 12; day = 31;
    }
  }
  const periodEnd = year && month && day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;

  // 类型：公告首列数字对应的口径。"三個月及九個月" 的简明报表首列是当季 → Qn。
  // "季度業績及…財務年度業績"（阿里 3 月/小鵬 Q4 年报合刊）先季度后全年 → 按季度处理，
  // 不启用 FY 区域限定——"第N季度"分支必须排在"年度|全年"前面，否则"…及2025財政年度"
  // 里的"年度"子串会先命中，把合刊季报错标成 FY。
  let periodType = "";
  if (/月底止季度|止三個月|止三个月/.test(title)) periodType = month ? `Q${Math.ceil(month / 3)}` : "Q";
  else if (/第[一二三四]季度/.test(title)) {
    const qm = title.match(/第([一二三四])季度/);
    periodType = `Q${CN_DIGIT[qm[1]]}`;
  }
  else if (/年度|全年/.test(title)) periodType = "FY";
  else if (/九個月|九个月/.test(title)) periodType = "9M";
  else if (/六個月|六个月|中期/.test(title)) periodType = "H1";
  else if (/^\d{4}\s*年\s*(業績|业绩)(公告|公佈)?$/.test(title)) periodType = "FY";

  const periodLabel = periodEnd
    ? `${year}${periodType ? ` ${periodType}` : ""}（截至 ${periodEnd}）`
    : title.slice(0, 40);
  return { periodEnd, periodType, periodLabel };
}

// ─── 三表关键行解析 ──────────────────────────────────────────────────

/**
 * 一行文本 → 数字列（纯函数）。
 * 规则：按两个以上空格分列；忽略含 % 的列；括号=负数；
 * 开头的 1-2 位无逗号整数视为脚注引用列（如 "收入成本  3  (85,193)"）丢弃。
 */
export function lineNumbers(line) {
  const out = [];
  for (const token of String(line).split(/\s{2,}/)) {
    if (token.includes("%")) continue;
    const m = token.match(/^\(?\s*-?([\d,]+(?:\.\d+)?)\s*\)?$/);
    if (!m) continue;
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push(token.includes("(") ? -value : value);
  }
  // 脚注引用列：首个数字是 <100 的无小数整数，且后面还有更大的数 → 丢弃。
  if (out.length >= 2 && Number.isInteger(out[0]) && Math.abs(out[0]) < 100 && Math.abs(out[1]) >= 100) {
    out.shift();
  }
  return out;
}

// B-6：字段名覆盖扩到"总收入/经营亏损/净亏损/银行业净利润"等多种行业表述——
// 腾讯/阿里式用"經營盈利/期內盈利"，小鵬（新能源车，常年亏损）用"經營虧損/淨（虧損）收益"，
// 汇丰（银行，无"毛利"概念）用"營業利潤/本年度利潤"。任一行业新增表述都加进对应字段的
// 备选项里，不新建字段——保持"一个字段=一个财务含义"，只是覆盖的中文表述变多。
// 括号风格两种都有：小鵬 Q4+FY 合刊用全角（虧損），Q1 独立季报用半角(虧損)——
// 数字列的负号解析（lineNumbers）依赖半角括号，不能全局归一化，只在这些标签正则里
// 用 [（(]/[）)] 字符类兼容两种。
/** @type {Array<[string, RegExp]>} */
const STATEMENT_FIELDS = [
  ["revenue", /^(收入|收益總額|營業額|營業收入|营业收入|總收入|总收入|營業收益淨額|营业收益净额)(?!成本|表)/],
  ["grossProfit", /^毛利(?!率)/],
  ["operatingIncome", /^(經營盈利|經營溢利|經營利潤|经营利润|營運溢利|經營虧損|经营亏损|營業利潤|营业利润)(?!率)/],
  ["netIncome", /^(期內盈利|期內溢利|期内利润|年度盈利|年度溢利|本期利潤|淨利潤|净利润|本年度利潤|本年度利润|淨[（(]虧損[）)]收益|净[（(]亏损[）)]收益|淨收益[（(]虧損[）)]|净收益[（(]亏损[）)]|淨虧損|净亏损)(?!率)/],
  ["netIncomeAttributable", /(本公司(權益持有人|擁有人|股東)應佔(盈利|溢利|利潤)|歸屬於普通股股東的淨利潤|归属于普通股股东的净利润|股東應佔淨[（(]虧損[）)]收益|股东应占净[（(]亏损[）)]收益|股東應佔淨收益[（(]虧損[）)]|股东应占净收益[（(]亏损[）)]|股東應佔淨虧損|股东应占净亏损|股東應佔淨收益|股东应占净收益|^應佔淨[（(]虧損[）)]收益|^應佔淨虧損|^[－\-—–]?\s*母公司普通股股東|^[－\-—–]?\s*母公司股東)/],
  ["operatingCashFlow", /(經營活動所得現金流量淨額|經營活動產生的現金流量淨額|經營業務所得現金淨額|经营活动产生的现金流量净额)/],
  ["cashAndEquivalents", /^(期末)?現金及現金等價物/],
  ["netCash", /^現金淨額/]
];

// 同行 EPS（阿里/汇丰式摘要表）：基本优先，只有摊薄时用摊薄。
const EPS_INLINE_BASIC = /^(基本每股收益|每股(普通股)?基本(及攤薄)?(盈利|收益|虧損))/;
const EPS_INLINE_DILUTED = /^(攤薄每股收益|每股(普通股)?攤薄(後)?(盈利|收益|虧損))(?!率)/;

/**
 * 表头年份行 → 列序（纯函数）。短行、无金额、含 ≥2 个不同年份时返回
 * "prior-first"（如阿里 "2024  2025"）或 "current-first"（如腾讯
 * "二零二六年 二零二五年"）；否则 null（不是表头行）。
 */
export function detectColumnOrder(line) {
  if (line.length > 60) return null;
  if (/\d{3},\d{3}/.test(line)) return null; // 含金额的叙述行不是表头
  const years = [];
  for (const m of line.matchAll(/(\d{4})\s*年?/g)) {
    const y = Number(m[1]);
    if (y >= 1990 && y <= 2100) years.push(y);
  }
  for (const m of line.matchAll(/([零〇一二三四五六七八九]{4})\s*年/g)) {
    const y = cnYear(m[1]);
    if (y) years.push(y);
  }
  if (years.length < 2 || years[0] === years[1]) return null;
  return years[0] < years[1] ? "prior-first" : "current-first";
}

// B-6：部分港股 PDF 生成工具（实测小鵬 ADR 版式公告）逐字符/逐数字单独分词——
// "小鵬汽車發佈2025年" 被抽成 "小 鵬 汽 車 發 佈 2 0 2 5 年"，破坏所有字段名/期间正则。
// 判定规则：真正的分栏空格固定 ≥2 个（列间距，数字列从不被这种逐字排版影响），
// 逐字符间距固定 1 个——按"单空格夹在两个中日韩字符/数字之间"坍缩，不动 ≥2 空格的列边界。
const WORDISH = "[\\u4e00-\\u9fff0-9A-Za-z]";
const CHAR_SPACING_RE = new RegExp(`(${WORDISH})\\x20(?=${WORDISH})`, "g");
export function collapseCharSpacing(text) {
  let out = String(text);
  let prev;
  do {
    prev = out;
    out = out.replace(CHAR_SPACING_RE, "$1");
  } while (out !== prev);
  return out;
}

/**
 * B-6：部分港股 PDF（实测汇丰 0005.HK）的字体子集把大量常见汉字编码成外观相同但码位
 * 不同的康熙部首／CJK 部首补充区变体（如"止"→⽌ U+2F4C、"月"→⽉ U+2F49、"行"→⾏ U+2F8F），
 * 全篇通用、不是个例——"止年度"这类正则因此全篇一个都匹配不到，NFKC 是 Unicode 标准
 * 兼容分解，能把这批变体准确折回标准汉字（js 内建 String.normalize，无需自建映射表）。
 */
export function normalizeCjkVariants(text) {
  return String(text).normalize("NFKC");
}

const CURRENCY_MAP = { 人民幣: "CNY", 人民币: "CNY", 港幣: "HKD", 港币: "HKD", 港元: "HKD", 美元: "USD" };
const UNIT_MAP = { 十億: 1e9, 十亿: 1e9, 百萬: 1e6, 百万: 1e6, 千: 1e3 };
const UNIT_ALT = "十億|十亿|百萬|百万|千";
// 币种+单位的词序两种都有：腾讯/阿里/小鵬式"人民幣百萬元"（币种在前），
// 汇丰式"（百萬美元）"逐行单位标注（单位在前，英文语序影响的表述）。
const CURRENCY_ALT = Object.keys(CURRENCY_MAP).join("|");
const UNIT_DECL_RE = new RegExp(`(?:${CURRENCY_ALT})(${UNIT_ALT})元?|(${UNIT_ALT})(?:${CURRENCY_ALT})|以(${UNIT_ALT})[計计]`);

/**
 * 纯币种表头行（如小鵬 4 栏"人民幣  人民幣  人民幣  美元"）：不含数字、
 * 每个分栏 token 都恰好是一个币种词 → 记录每栏币种，供后续数字行按"只留主报告币种列
 * （丢掉尾栏美元换算）"过滤（纯函数）。
 */
function currencyHeaderColumns(line) {
  if (/\d/.test(line)) return null;
  const tokens = line.split(/\s{2,}/).map((t) => t.trim()).filter(Boolean);
  // 取从头开始连续的币种词前缀，不要求整行都是（阿里式表头多一列非币种的说明栏
  // "人民幣  人民幣  美元  %同比變動"——最后一栏是变动率标签，不是币种，但前 3 栏
  // 仍是真实的分栏币种，且和去掉 % 列之后的数字列数（3）对得上）。
  const prefix = [];
  for (const t of tokens) {
    if (!Object.prototype.hasOwnProperty.call(CURRENCY_MAP, t)) break;
    prefix.push(CURRENCY_MAP[t]);
  }
  return prefix.length >= 2 ? prefix : null;
}

function endsWithProfitWord(line) {
  return /(收益|虧損|亏损|溢利|盈利|利潤|利润)$/.test(line || "");
}

/**
 * 业绩公告全文 → 关键财务行（纯函数）。
 * 返回 { currency, unitLabel, unit, fields: { revenue: {current, prior}, … }, found }。
 * 数值已按检测到的单位换算成绝对币值；EPS 为每股值不做单位换算。
 *
 * periodType="FY" 时启用区域限定：年度公告（如腾讯）第一页先放"第四季摘要"再放
 * "全年摘要"，不加限定会把 Q4 列错标成全年。区域由表头行切换：
 * "截至…止三個月/六個月/九個月/第N季" → Q 区，"截至…止年度/全年" → FY 区。
 *
 * B-6：单位改成随行扫描的局部状态（不是整篇文档一次性正则）——同一份公告不同章节可能
 * 用不同单位（小鵬摘要页"十億元"、三表页"千"），整篇一次性匹配只会抓到第一个撞见的
 * 声明，套到后面章节的数字上就会差好几个数量级。数字列也扩展到 ≥3 栏（小鵬季报"上年同季
 * / 上季 / 本季 / 美元换算"4 栏）：先按币种表头丢掉非主报告币种列（美元换算），剩 ≥3 栏
 * 时取首列=去年同期、末列=本期（按年口径，和别处 revenueGrowth 一致）。
 */
export function parseResultsText(rawText = "", { periodType = "" } = {}) {
  const wantScope = periodType === "FY" ? "FY" : null;
  const text = collapseCharSpacing(normalizeCjkVariants(rawText));
  const lines = text.split("\n");

  // 整体币种：仍用词频（一份公告主币种通常占绝对多数，附注偶尔提到其它币种不影响判断）。
  let currency = null;
  {
    let best = 0;
    for (const [word, code] of Object.entries(CURRENCY_MAP)) {
      const count = (text.match(new RegExp(word, "g")) || []).length;
      if (count > best) { best = count; currency = code; }
    }
  }

  const fields = {};
  let epsDiluted = null;
  let epsSection = false;
  let scope = null; // null=未知区域，"Q"=季度/半年区，"FY"=年度区
  let priorFirst = false; // 列序：阿里等把去年同期放第一列（表头 "2024  2025"）
  let unit = 1;
  let unitLabel = "";
  let columnCurrencies = null; // 如 ["CNY","CNY","CNY","USD"]：数字行按此丢弃非主报告币种列
  let skipSummary = false; // 是否处在"主要財務業績"粗精度摘要表区域内（跳过，等正式三表）
  let prevLine = "";

  const pick = (nums, scale = 1) => {
    let vals = nums;
    if (columnCurrencies && columnCurrencies.length === nums.length) {
      const primary = vals.filter((_, i) => columnCurrencies[i] === currency);
      if (primary.length) vals = primary;
    }
    if (vals.length >= 3) {
      // 多栏（去年同季 / 上季 / 本季 [/ 美元换算已丢弃]）：首列=去年同期，末列=本期——
      // 按年口径，和别处 revenueGrowth/profitGrowth 一致（不是按季环比）。
      return { current: vals[vals.length - 1] * scale, prior: vals[0] * scale };
    }
    return {
      current: (vals.length > 1 && priorFirst ? vals[1] : vals[0]) * scale,
      prior: vals.length > 1 ? (priorFirst ? vals[0] : vals[1]) * scale : null
    };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const prev = prevLine;
    prevLine = line;

    // B-6：部分公告在正式三表前先放一段"主要財務業績/財務摘要"展示表——数字是四舍五入过的
    // 粗精度（如"22.25"十億元），列序也常和后面正式三表相反（当季在前，正式三表反而是
    // 去年同期在前）。first-match-wins 会让这段粗数据抢在精确的正式三表数字前面锁定字段，
    // 必须跳过直到进入真正的"未經審計簡明綜合…表"区域。
    if (/^(主要財務|主要财务|財務摘要|財務業績|财务摘要|财务业绩|業務摘要|营运及财务摘要|營運及財務摘要)/.test(line)) { skipSummary = true; continue; }
    if (skipSummary && /^(管理層評語|管理层评语|未經審計簡明綜合|簡明綜合|綜合收益表|綜合財務狀況表|綜合現金流量表|综合收益表|综合财务状况表|综合现金流量表)/.test(line)) skipSummary = false;
    if (skipSummary) continue;

    const cols = currencyHeaderColumns(line);
    if (cols) { columnCurrencies = cols; continue; }

    const unitDecl = line.match(UNIT_DECL_RE);
    if (unitDecl) {
      const word = unitDecl[1] || unitDecl[2] || unitDecl[3];
      if (UNIT_MAP[word]) { unit = UNIT_MAP[word]; unitLabel = `${word}元`; }
    }

    const order = detectColumnOrder(line);
    if (order) priorFirst = order === "prior-first";

    if (/止年度|止兩個年度|全年業績|全年业绩/.test(line)) scope = "FY";
    else if (/止三個月|止六個月|止九個月|止三个月|止六个月|止九个月|第[一二三四]季/.test(line) && !/年度/.test(line)) scope = "Q";
    const scopeOk = !wantScope || scope === wantScope || scope === null;

    // EPS 三种版式：腾讯式 "每股盈利" 标题 + 下一行 "－基本"；阿里/汇丰式同行
    // "攤薄每股收益 2.55 0.74"；小鵬式两行头（"…每股普通股" + "淨（虧損）收益"）+
    // 下一行 "基本"（无破折号）——用"上一行以盈利/亏损类名词结尾"识别这第三种，
    // 并用量级护栏（<1000）排除紧邻的"加权平均股数"基本/摊薄行（那是股数不是每股盈利）。
    if (/^每股(盈利|溢利|收益)/.test(line) && !/非國際|非国际/.test(line)) epsSection = true;
    else if (epsSection && /^[－\-—–]?\s*基本/.test(line)) {
      const nums = lineNumbers(line);
      if (nums.length && fields.eps === undefined && scopeOk) fields.eps = pick(nums);
      epsSection = false;
    } else if (epsSection && !/^[－\-—–（(]/.test(line)) {
      epsSection = false;
    }
    if (scopeOk && fields.eps === undefined && EPS_INLINE_BASIC.test(line)) {
      const nums = lineNumbers(line);
      if (nums.length) fields.eps = pick(nums);
    } else if (scopeOk && !epsDiluted && EPS_INLINE_DILUTED.test(line)) {
      const nums = lineNumbers(line);
      if (nums.length) epsDiluted = pick(nums);
    } else if (scopeOk && fields.eps === undefined && /^基本(及攤薄)?\s/.test(line) && endsWithProfitWord(prev)) {
      const nums = lineNumbers(line);
      if (nums.length && nums.every((n) => Math.abs(n) < 1000)) fields.eps = pick(nums);
    }

    if (!scopeOk) continue;
    for (const [key, pattern] of STATEMENT_FIELDS) {
      if (fields[key] !== undefined || !pattern.test(line)) continue;
      const nums = lineNumbers(line);
      // 分部/业务线拆分表（如汇丰按 5 个业务分部+总计列出的"营业利润"）常年年年和总表
      // 共用同一套词汇，却挤在正式合并报表前面出现；first-match-wins 会让分部数字抢注
      // 合并总表的字段。真正的合并三表目前见过最多 4 栏（本期/上期[/上季][/美元换算]），
      // 超过这个栏数基本就是分部拆分表，跳过等真正的合并总表行。
      if (!nums.length || nums.length > 4) continue;
      fields[key] = pick(nums, unit);
    }
  }
  if (fields.eps === undefined && epsDiluted) fields.eps = epsDiluted; // 只有摊薄时用摊薄

  return { currency, unit, unitLabel, fields, found: Object.keys(fields).length };
}

// ─── PDF 下载 + 抽取 + 摄取 ──────────────────────────────────────────

async function downloadPdf(url, filePath) {
  try {
    await access(filePath);
    return; // 已缓存
  } catch { /* 继续下载 */ }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 EchoResearch/0.1 HKEX filings pipeline" }
    });
    if (!response.ok) throw new Error(`下载失败 ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 10000) throw new Error(`PDF 过小（${buffer.length}B），疑似错误页`);
    mkdirSync(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
  } finally {
    clearTimeout(timer);
  }
}

async function extractPdfText(pdfPath) {
  const { stdout } = await execFileAsync("python3", [EXTRACT_SCRIPT, pdfPath], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120000
  });
  if (!stdout || stdout.length < 500) throw new Error("PDF 文本抽取结果过短");
  return stdout;
}

/**
 * 摄取一只港股最近 N 份业绩公告 → hk_financials。
 * 幂等：同 source_url 已入库则跳过（force 覆盖）。
 */
export async function ingestHkFinancials(ticker, { limit = 3, force = false } = {}) {
  const t = normalizeTicker(ticker);
  if (isUS(t)) throw new Error(`${t} 是美股，港股管道不适用`);
  let announcements;
  try {
    announcements = await searchHkexResultsAnnouncements(t);
  } catch (error) {
    logIngestOutcome({ ticker: t, status: "search_failed", detail: error.message || String(error) });
    throw error;
  }
  const result = { ticker: t, ingested: [], skipped: [], errors: [] };

  for (const item of announcements.slice(0, limit)) {
    try {
      if (!force && hasHkFinancialsForUrl(item.url)) {
        result.skipped.push(item.title);
        continue;
      }
      const pdfPath = join(CACHE_DIR, `${t.replace(/\W+/g, "_")}_${item.newsId || item.publishedAt.slice(0, 10)}.pdf`);
      await downloadPdf(item.url, pdfPath);
      const text = await extractPdfText(pdfPath);
      const period = parsePeriodFromTitle(item.title);
      const parsed = parseResultsText(text, { periodType: period.periodType });
      if (!parsed.fields.revenue && !parsed.fields.netIncome) {
        throw new Error("解析不到收入/盈利行（可能非标准业绩公告格式）");
      }
      // 可信度护栏：营收为负是不可能的真实财务状态（一定是抓到了备注/附注里的某个
      // "收入/(开支)"分项而非合并利润表——如寿险公司大量附注表恰好也以"收入"开头）。
      // 宁可报错跳过，也不能把这种明显不合理的数字写进库、后续被估值引擎当真数据用。
      if (parsed.fields.revenue?.current < 0) {
        throw new Error(`解析到的收入为负（${parsed.fields.revenue.current}），疑似匹配到附注/分项表而非合并利润表`);
      }
      const f = parsed.fields;
      upsertHkFinancials({
        ticker: t,
        periodLabel: period.periodLabel,
        periodEnd: period.periodEnd,
        periodType: period.periodType,
        currency: parsed.currency,
        unitLabel: parsed.unitLabel,
        revenue: f.revenue?.current ?? null,
        revenuePrior: f.revenue?.prior ?? null,
        grossProfit: f.grossProfit?.current ?? null,
        grossProfitPrior: f.grossProfit?.prior ?? null,
        operatingIncome: f.operatingIncome?.current ?? null,
        operatingIncomePrior: f.operatingIncome?.prior ?? null,
        netIncome: f.netIncome?.current ?? null,
        netIncomePrior: f.netIncome?.prior ?? null,
        netIncomeAttributable: f.netIncomeAttributable?.current ?? null,
        eps: f.eps?.current ?? null,
        operatingCashFlow: f.operatingCashFlow?.current ?? null,
        cashAndEquivalents: f.cashAndEquivalents?.current ?? null,
        netCash: f.netCash?.current ?? null,
        sourceTitle: item.title,
        sourceUrl: item.url,
        publishedAt: item.publishedAt
      });
      // 全文进 documents 表，研究会话可引用原文段落。
      try {
        addDocument({
          ticker: t,
          name: item.title,
          mimeType: "text/plain",
          size: text.length,
          parser: "extract_pdf_text",
          text: text.slice(0, 300000),
          sourceType: "hkex-results",
          sourceUrl: item.url
        });
      } catch { /* 文档留档失败不影响主数据 */ }
      result.ingested.push({
        title: item.title,
        period: period.periodLabel,
        revenue: f.revenue?.current ?? null,
        netIncome: f.netIncome?.current ?? null,
        url: item.url
      });
    } catch (error) {
      result.errors.push(`${item.title}: ${error.message}`);
    }
  }
  logIngestOutcome({
    ticker: t,
    status: classifyIngestStatus(announcements, result),
    detail: result.errors[0] || (announcements.length === 0 ? "HKEX 未搜到业绩公告（可能新上市/停牌/退市/代码库有误）" : null),
    announcementsFound: announcements.length,
    ingestedCount: result.ingested.length
  });
  return result;
}

/**
 * 摄取结果 → 覆盖率面板用的粗粒度状态（纯函数，供单测覆盖）。
 * ok：本次或此前已有至少一条一手数据；no_announcements：HKEX 侧真没有公告；
 * parse_failed：搜到公告但一条都没抽出来（下载/PDF 解析/护栏拒收）。
 */
export function classifyIngestStatus(announcements, result) {
  if (result.ingested.length > 0 || result.skipped.length > 0) return "ok";
  if (announcements.length === 0) return "no_announcements";
  return "parse_failed";
}

function logIngestOutcome(entry) {
  try { upsertHkFilingIngestLog(entry); } catch { /* 留痕失败不影响摄取结果本身 */ }
}

// ─── F-4b：HKEX 购回报告解析 + 摄取 ───────────────────────────────────

/**
 * "翌日披露报表"（FF305 表格）抽取文本 → 购回事实（纯函数）。真实调用验证：
 * 0700.HK 两份不同日期的公告均能稳定匹配（见 PLAN.md F-4b 记录）。
 *
 * 只解析第二章节"购回报告"部分（真实成交的购回股数/价格区间/总代价）——不解析
 * 第一部分 B 段"已购回作注销但尚未注销的股份"（那是累计未注销清单，会和这里的
 * "本次实际购回"重复计数，两者口径不同，混用会重复统计同一批股份）。
 * 同时抽取第一部分 A 段的期末已发行股份总数，作为股本趋势的粗线数据——HKEX 规则下
 * 购回股份注销有滞后，这个数字不等于"购回后即时股本"，只是逐次披露间的变化趋势。
 */
export function parseBuybackText(text = "") {
  const shareTotalMatch = text.match(/於下列日期結束時的結存\s*\(註5及6\)\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s+([\d,]+)\s+\d+\s+([\d,]+)/);
  const periodEndDate = shareTotalMatch
    ? `${shareTotalMatch[1]}-${shareTotalMatch[2].padStart(2, "0")}-${shareTotalMatch[3].padStart(2, "0")}`
    : null;
  const sharesIssuedTotal = shareTotalMatch ? Number(shareTotalMatch[5].replace(/,/g, "")) : null;

  const rowRe = /\d+\)\.\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s+([\d,]+)\s*於本交易所進行\s*([A-Z]{3})\s*([\d.]+)\s*[A-Z]{3}\s*([\d.]+)\s*[A-Z]{3}\s*([\d,]+)/g;
  const rows = [];
  let m;
  while ((m = rowRe.exec(text))) {
    rows.push({
      tradeDate: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`,
      sharesRepurchased: Number(m[4].replace(/,/g, "")),
      currency: m[5],
      priceHigh: Number(m[6]),
      priceLow: Number(m[7]),
      totalConsideration: Number(m[8].replace(/,/g, ""))
    });
  }
  return { rows, sharesIssuedTotal, periodEndDate };
}

/**
 * 摄取一只港股最近 daysBack 天的翌日披露购回报表 → hk_buybacks。
 * 幂等：同 source_url 已入库则跳过（unique 约束 + hasHkBuybackForUrl 双重防重复）。
 * 单份公告解析不到购回行（如公告本身只是股份归属变动、没有真实购回）不算错误，
 * 诚实跳过——不是每份"購回"关键词命中的公告都真的有第二章节。
 */
export async function ingestHkBuybacks(ticker, { daysBack = 180, limit = 30, force = false } = {}) {
  const t = normalizeTicker(ticker);
  if (isUS(t)) throw new Error(`${t} 是美股，港股回购管道不适用`);
  let announcements;
  try {
    announcements = await searchHkexBuybackAnnouncements(t, { daysBack });
  } catch (error) {
    logIngestOutcome({ ticker: t, status: "search_failed", detail: error.message || String(error) });
    throw error;
  }
  const result = { ticker: t, ingested: [], skipped: [], errors: [] };

  for (const item of announcements.slice(0, limit)) {
    try {
      if (!force && hasHkBuybackForUrl(item.url)) {
        result.skipped.push(item.title);
        continue;
      }
      const pdfPath = join(CACHE_DIR, `${t.replace(/\W+/g, "_")}_buyback_${item.publishedAt.slice(0, 10)}_${item.url.split("/").pop()}`);
      await downloadPdf(item.url, pdfPath);
      const text = await extractPdfText(pdfPath);
      const { rows, sharesIssuedTotal, periodEndDate } = parseBuybackText(text);
      if (!rows.length) {
        result.skipped.push(`${item.title}（无第二章节购回行）`);
        continue;
      }
      for (const row of rows) {
        upsertHkBuyback({
          ticker: t,
          tradeDate: row.tradeDate,
          sharesRepurchased: row.sharesRepurchased,
          priceHigh: row.priceHigh,
          priceLow: row.priceLow,
          totalConsideration: row.totalConsideration,
          currency: row.currency,
          sharesIssuedTotal,
          periodEndDate,
          sourceTitle: item.title,
          sourceUrl: item.url,
          publishedAt: item.publishedAt
        });
      }
      result.ingested.push({ title: item.title, rows: rows.length, url: item.url });
    } catch (error) {
      result.errors.push(`${item.title}: ${error.message}`);
    }
  }
  logIngestOutcome({
    ticker: t,
    status: result.ingested.length > 0 || result.skipped.length > 0 ? "ok" : (announcements.length === 0 ? "no_announcements" : "parse_failed"),
    detail: result.errors[0] || (announcements.length === 0 ? "HKEX 未搜到购回公告（近期可能未回购）" : null),
    announcementsFound: announcements.length,
    ingestedCount: result.ingested.length
  });
  return result;
}

// ─── hk_financials 行 → financialsData 形状（纯函数） ────────────────

/**
 * 把最新一手行提升为 getFinancials 同形状的主财务对象。
 * 仅在第三方链路（FMP/Finnhub/Yahoo/腾讯）全挂时作为主数据用；
 * 平时以 financialsData.hkFilings 附挂，作为事实块的一手佐证。
 */
export function hkRowToFinancials(row) {
  const growth = (cur, prior) => (cur != null && prior ? Math.round(((cur - prior) / Math.abs(prior)) * 1000) / 10 : null);
  const margin = (part) => (row.revenue && part != null ? (part / row.revenue) * 100 : null);
  return {
    source: "HKEX 业绩公告 PDF（一手抽取）",
    ticker: row.ticker,
    period: row.period_label || row.period_end || "",
    currency: row.currency || "HKD",
    revenue: row.revenue ?? null,
    revenueGrowth: growth(row.revenue, row.revenue_prior),
    grossProfit: row.gross_profit ?? null,
    grossMargin: margin(row.gross_profit),
    operatingIncome: row.operating_income ?? null,
    operatingMargin: margin(row.operating_income),
    netIncome: row.net_income ?? null,
    netMargin: margin(row.net_income),
    profitGrowth: growth(row.net_income, row.net_income_prior),
    eps: row.eps ?? null,
    operatingCashFlow: row.operating_cash_flow ?? null,
    cashAndEquivalents: row.cash_and_equivalents ?? null,
    // 公告 PDF 通常只给"净现金"一个数，不拆分现金/负债——单独暴露出来，
    // 好让 valuationEngine 直接用它（而不是靠 cash-debt 相减，totalDebt 在这条链路上从不存在）。
    netCash: row.net_cash ?? null,
    asOf: row.extracted_at || new Date().toISOString(),
    providerStatus: "ok",
    firstParty: true,
    sourceUrl: row.source_url || null
  };
}

// ─── 后台刷新（研究请求不阻塞） ──────────────────────────────────────

const inflight = new Set();

export function refreshHkFinancialsInBackground(ticker) {
  const t = normalizeTicker(ticker);
  if (isUS(t) || inflight.has(t)) return;
  inflight.add(t);
  ingestHkFinancials(t)
    .catch(() => { /* 后台任务失败静默，下次研究再触发 */ })
    .finally(() => inflight.delete(t));
}

const buybackInflight = new Set();

/** F-4b：同款"研究请求不阻塞、后台刷新"节奏，独立的 inflight 集合（不跟财报摄取抢占）。 */
export function refreshHkBuybacksInBackground(ticker) {
  const t = normalizeTicker(ticker);
  if (isUS(t) || buybackInflight.has(t)) return;
  buybackInflight.add(t);
  ingestHkBuybacks(t)
    .catch(() => { /* 后台任务失败静默，下次研究再触发 */ })
    .finally(() => buybackInflight.delete(t));
}
