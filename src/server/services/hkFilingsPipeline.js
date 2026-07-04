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
import { normalizeTicker } from "../../data.js";
import { isUS } from "../../market.js";
import { upsertHkFinancials, hasHkFinancialsForUrl } from "../repositories/hkFinancialsRepository.js";
import { addDocument } from "../repositories/documentRepository.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(here, "..", "..", "..");
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

async function lookupStockId(ticker) {
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

/**
 * 公告标题 → { periodEnd, periodType, periodLabel }（纯函数）。
 * "截至二零二六年三月三十一日止三個月業績公佈" → { periodEnd:"2026-03-31", periodType:"Q1", … }
 * 覆盖：年度/三個月(Qn)/六個月(H1)/九個月(9M)，中文或阿拉伯数字日期。
 */
export function parsePeriodFromTitle(title = "") {
  let year = null, month = null, day = null;
  const cn = title.match(/截至\s*([零〇一二三四五六七八九]{4})\s*年\s*([零〇一二三四五六七八九十]{1,3})\s*月\s*([零〇一二三四五六七八九十]{1,3})\s*日/);
  const monthEnd = title.match(/(\d{4})\s*年\s*([零〇一二三四五六七八九十]{1,3}|\d{1,2})\s*月底止/); // 阿里式 "2026年三月底止季度"
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
    if (ar) { year = Number(ar[1]); month = Number(ar[2]); day = Number(ar[3]); }
  }
  const periodEnd = year && month && day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;

  // 类型：公告首列数字对应的口径。"三個月及九個月" 的简明报表首列是当季 → Qn。
  // "季度業績及…財務年度業績"（阿里 3 月）先季度后全年 → 按季度处理，不启用 FY 区域限定。
  let periodType = "";
  if (/月底止季度|止三個月|止三个月/.test(title)) periodType = month ? `Q${Math.ceil(month / 3)}` : "Q";
  else if (/年度|全年/.test(title)) periodType = "FY";
  else if (/九個月|九个月/.test(title)) periodType = "9M";
  else if (/六個月|六个月|中期/.test(title)) periodType = "H1";

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

const STATEMENT_FIELDS = [
  ["revenue", /^(收入|收益總額|營業額|營業收入|营业收入)(?!成本|表)/],
  ["grossProfit", /^毛利(?!率)/],
  ["operatingIncome", /^(經營盈利|經營溢利|經營利潤|经营利润|營運溢利)(?!率)/],
  ["netIncome", /^(期內盈利|期內溢利|期内利润|年度盈利|年度溢利|本期利潤|淨利潤|净利润)(?!率)/],
  ["netIncomeAttributable", /^(本公司(權益持有人|擁有人|股東)應佔(盈利|溢利|利潤)|歸屬於普通股股東的淨利潤|归属于普通股股东的净利润)/],
  ["operatingCashFlow", /(經營活動所得現金流量淨額|經營活動產生的現金流量淨額|經營業務所得現金淨額|经营活动产生的现金流量净额)/],
  ["cashAndEquivalents", /^(期末)?現金及現金等價物/],
  ["netCash", /^現金淨額/]
];

// 同行 EPS（阿里式摘要表）：基本优先，只有摊薄时用摊薄。
const EPS_INLINE_BASIC = /^(基本每股收益|每股基本(及攤薄)?(盈利|收益))/;
const EPS_INLINE_DILUTED = /^攤薄每股收益(?!率)/;

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

/**
 * 业绩公告全文 → 关键财务行（纯函数）。
 * 返回 { currency, unitLabel, unit, fields: { revenue: {current, prior}, … }, found }。
 * 数值已按检测到的单位换算成绝对币值；EPS 为每股值不做单位换算。
 *
 * periodType="FY" 时启用区域限定：年度公告（如腾讯）第一页先放"第四季摘要"再放
 * "全年摘要"，不加限定会把 Q4 列错标成全年。区域由表头行切换：
 * "截至…止三個月/六個月/九個月/第N季" → Q 区，"截至…止年度/全年" → FY 区。
 */
export function parseResultsText(text = "", { periodType = "" } = {}) {
  const wantScope = periodType === "FY" ? "FY" : null;
  const lines = String(text).split("\n");

  const CURRENCY_MAP = { 人民幣: "CNY", 人民币: "CNY", 港幣: "HKD", 港币: "HKD", 港元: "HKD", 美元: "USD" };
  let currency = null;
  let unit = 1;
  let unitLabel = "";
  const unitMatch = text.match(/[（(]?(人民幣|人民币|港幣|港币|港元|美元)(百萬|百万|千)元?/);
  if (unitMatch) {
    currency = CURRENCY_MAP[unitMatch[1]] || null;
    unit = unitMatch[2] === "千" ? 1e3 : 1e6;
    unitLabel = `${unitMatch[1]}${unitMatch[2]}元`;
  } else {
    // 阿里式："（以百萬計，百分比及每股數據除外）"——单位与币种分开出现。
    const bare = text.match(/以(百萬|百万|千)計|以(百萬|百万|千)计/);
    if (bare) {
      const u = bare[1] || bare[2];
      unit = u === "千" ? 1e3 : 1e6;
      unitLabel = `${u}元`;
    }
    // 币种取全文词频最高者（封面/附注常零星提到别的币种，报表主币种出现次数占绝对多数）。
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
  const pick = (nums, scale = 1) => ({
    current: (nums.length > 1 && priorFirst ? nums[1] : nums[0]) * scale,
    prior: nums.length > 1 ? (priorFirst ? nums[0] : nums[1]) * scale : null
  });

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const order = detectColumnOrder(line);
    if (order) priorFirst = order === "prior-first";

    if (/止年度|止兩個年度|全年業績|全年业绩/.test(line)) scope = "FY";
    else if (/止三個月|止六個月|止九個月|止三个月|止六个月|止九个月|第[一二三四]季/.test(line) && !/年度/.test(line)) scope = "Q";
    const scopeOk = !wantScope || scope === wantScope || scope === null;

    // EPS 两种版式：腾讯式 "每股盈利" 标题 + 下一行 "－基本"；阿里式同行 "攤薄每股收益 2.55 0.74"。
    if (/^每股(盈利|溢利|收益)/.test(line) && !/非國際|非国际/.test(line)) epsSection = true;
    else if (epsSection && /^[－\-—]?\s*基本/.test(line)) {
      const nums = lineNumbers(line);
      if (nums.length && fields.eps === undefined && scopeOk) fields.eps = pick(nums);
      epsSection = false;
    } else if (epsSection && !/^[－\-—（(]/.test(line)) {
      epsSection = false;
    }
    if (scopeOk && fields.eps === undefined && EPS_INLINE_BASIC.test(line)) {
      const nums = lineNumbers(line);
      if (nums.length) fields.eps = pick(nums);
    } else if (scopeOk && !epsDiluted && EPS_INLINE_DILUTED.test(line)) {
      const nums = lineNumbers(line);
      if (nums.length) epsDiluted = pick(nums);
    }

    if (!scopeOk) continue;
    for (const [key, pattern] of STATEMENT_FIELDS) {
      if (fields[key] !== undefined || !pattern.test(line)) continue;
      const nums = lineNumbers(line);
      if (!nums.length) continue;
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
  const announcements = await searchHkexResultsAnnouncements(t);
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
