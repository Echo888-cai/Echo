/**
 * cnFilingsPipeline — A 股一手数据管道（P-CN-2），巨潮资讯网对应 hkFilingsPipeline 的角色。
 *
 * 巨潮资讯网公告列表（hisAnnouncement/query JSON 接口，官方指定披露平台）→
 * 定期报告 PDF 下载（.cache/filings/）→ scripts/document-processing/extract_pdf_text.py 抽文本
 * （复用港股管道同一份抽取脚本）→ 解析三表关键行（营业收入/营业成本/营业利润/
 * 净利润/归属于母公司股东的净利润/EPS/经营活动现金流量净额/货币资金）→
 * cn_financials 表（绝对币值，A 股财报几乎全是 CNY，不需要港股那套 CNY→HKD 换算）。
 *
 * 相比港股管道，A 股定期报告受统一会计准则强制模板约束，三表字段名/版式全市场
 * 高度一致（不像港股各公司 PDF 排版千差万别）——解析器因此显著更简单，但银行/
 * 保险等金融业没有"营业成本"概念，毛利相关字段会诚实留空（缺失≠编造），不强凑。
 *
 * 解析全部是导出的纯函数（parseCninfoSearchResult / parseCnPeriodFromTitle /
 * parseCnResultsText），无网络即可单测。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cnTicker, cnCode, cnExchange, isCN } from "@echo/data-plane";
import { upsertCnFinancials, hasCnFinancialsForUrl, upsertCnFilingIngestLog } from "@echo/db/repositories/cnFinancialsRepository.js";
import { addDocument } from "@echo/db/repositories/documentRepository.js";
import { classifyIngestStatus } from "./hkFilingsPipeline.js";

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(here, "..", "..", "..", "..");
const EXTRACT_SCRIPT = join(PROJECT_ROOT, "scripts", "document-processing", "extract_pdf_text.py");
const CACHE_DIR = join(PROJECT_ROOT, ".cache", "filings");

const CNINFO_BASE = "http://www.cninfo.com.cn";
const CNINFO_STATIC = "http://static.cninfo.com.cn";
const orgIdCache = new Map();

// ─── 巨潮资讯网搜索 ───────────────────────────────────────────────────

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 EchoResearch/0.1 CNINFO filings pipeline",
        Referer: `${CNINFO_BASE}/`,
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 120)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/** ticker → 巨潮资讯网内部 orgId（如 "600519" → "gssh0600519"）。 */
export async function lookupOrgId(ticker) {
  const code = cnCode(ticker);
  if (orgIdCache.has(code)) return orgIdCache.get(code);
  const json = await fetchJson(`${CNINFO_BASE}/new/information/topSearch/query`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ keyWord: code, maxSecNum: "5", maxListedNum: "5" }),
    timeoutMs: 8000
  });
  const hit = Array.isArray(json) ? json.find((r) => r.code === code) : null;
  if (!hit?.orgId) throw new Error(`巨潮资讯网没有匹配到 ${code} 的 orgId`);
  orgIdCache.set(code, hit.orgId);
  return hit.orgId;
}

// 定期报告分类代码（巨潮资讯网固定编码）：年报/一季报/中报（半年报）/三季报。
const REPORT_CATEGORIES = "category_ndbg_szsh;category_yjdbg_szsh;category_zqbg_szsh;category_sjdbg_szsh;";

// 摘要/英文版/审计意见单独公告不含完整三表原文，直接排除；只留正文报告。
const NOISE_TITLE = /摘要|英文版|(English)|审计报告|监事会|独立董事/;

/**
 * hisAnnouncement/query 响应 → 定期报告清单（纯函数）。
 * @param {object} raw - { announcements: [...] }
 */
export function parseCninfoSearchResult(raw) {
  const rows = Array.isArray(raw?.announcements) ? raw.announcements : [];
  return rows
    .map((r) => ({
      title: String(r.announcementTitle || "").trim(),
      publishedAt: r.announcementTime ? new Date(r.announcementTime).toISOString().slice(0, 10) : "",
      url: r.adjunctUrl ? `${CNINFO_STATIC}/${r.adjunctUrl}` : ""
    }))
    .filter((r) => r.url && r.title && !NOISE_TITLE.test(r.title))
    .sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}

/**
 * 最近 yearsBack 年的定期报告列表（年报+一/半年/三季报，新→旧，按期间去重——
 * 同一期间若有"更正后"重发公告，两份都会命中巨潮的分类检索，按期间去重只留
 * 发布时间更晚的一份（更正版天然更晚），避免同一期间在 cn_financials 里出现两行）。
 */
export async function searchCninfoReportsAnnouncements(ticker, { yearsBack = 2, rowRange = 40 } = {}) {
  const t = cnTicker(ticker);
  const code = cnCode(t);
  const orgId = await lookupOrgId(t);
  const now = new Date();
  const from = `${now.getFullYear() - yearsBack}-01-01`;
  const to = now.toISOString().slice(0, 10);
  const column = cnExchange(t) === "SS" ? "sse" : "szse";
  const body = new URLSearchParams({
    pageNum: "1",
    pageSize: String(rowRange),
    column,
    tabName: "fulltext",
    plate: "",
    stock: `${code},${orgId}`,
    searchkey: "",
    secid: "",
    category: REPORT_CATEGORIES,
    trade: "",
    seDate: `${from}~${to}`
  });
  const raw = await fetchJson(`${CNINFO_BASE}/new/hisAnnouncement/query`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    timeoutMs: 12000
  });
  const list = parseCninfoSearchResult(raw);

  // 按期间去重（同一 periodEnd+periodType 只留最新一份，见上方注释）。
  const seen = new Map();
  for (const item of list) {
    const period = parseCnPeriodFromTitle(item.title);
    if (!period.periodEnd) continue; // 不认识的标题（非定期报告正文）直接跳过
    const key = `${period.periodEnd}_${period.periodType}`;
    if (!seen.has(key)) seen.set(key, { ...item, period });
  }
  return [...seen.values()].sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}

// ─── 期间解析 ────────────────────────────────────────────────────────

/**
 * 公告标题 → { periodEnd, periodType, periodLabel }（纯函数）。
 * A 股定期报告标题高度模板化："XXX2026年第一季度报告"/"XXX2026年一季度报告"
 * （"第"字可有可无，实测平安银行用"一季度"、贵州茅台用"第一季度"）、
 * "XXX2025年半年度报告"/"XXX2025年中期报告"、"XXX2025年年度报告"、
 * "XXX2025年第三季度报告"。不认识的标题（如临时公告）返回全 null。
 */
export function parseCnPeriodFromTitle(title = "") {
  const fy = title.match(/(\d{4})年年度报告$/);
  if (fy) {
    const year = Number(fy[1]);
    return { periodEnd: `${year}-12-31`, periodType: "FY", periodLabel: `${year} FY（截至 ${year}-12-31）` };
  }
  const q = title.match(/(\d{4})年第?([一二三四])季度报告$/);
  if (q) {
    const year = Number(q[1]);
    const qn = { 一: 1, 二: 2, 三: 3, 四: 4 }[q[2]];
    const qEnd = { 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" }[qn];
    return { periodEnd: `${year}-${qEnd}`, periodType: `Q${qn}`, periodLabel: `${year} Q${qn}（截至 ${year}-${qEnd}）` };
  }
  const h1 = title.match(/(\d{4})年(半年度|中期)报告$/);
  if (h1) {
    const year = Number(h1[1]);
    return { periodEnd: `${year}-06-30`, periodType: "H1", periodLabel: `${year} H1（截至 ${year}-06-30）` };
  }
  return { periodEnd: null, periodType: null, periodLabel: null };
}

// ─── 三表关键行解析 ──────────────────────────────────────────────────

/**
 * 一行文本去掉已匹配的标签前缀后 → 数字列（纯函数）。
 * A 股 PDF 抽取后标签与首个数字之间有时只有单个空格（不像港股稳定 ≥2 空格），
 * 所以不能靠"按 2+ 空格切分整行"，必须先精确匹配掉标签，只对标签之后的
 * 剩余文本按任意空白切分——这样无论标签数字间隔几个空格都不受影响。
 * 括号（全角/半角）视为负数；含 % 的列（同比变动幅度）跳过。
 */
function numbersFromRemainder(rest = "") {
  const out = [];
  for (const token of rest.split(/\s+/)) {
    if (!token) continue;
    if (token.includes("%")) continue;
    const m = token.match(/^[（(]?\s*-?([\d,]+(?:\.\d+)?)\s*[）)]?$/);
    if (!m) continue;
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push({ value: /^[（(]/.test(token) ? -value : value, hasDecimal: m[1].includes(".") });
  }
  // 附注引用列（如银行报表常见"基本每股收益(人民币元)  48  2.07  2.15"里的脚注编号 48）：
  // 首个数字是无小数点的小整数，而后面同一行的其余数字都带小数点——同一张统一模板报表里
  // 同一行的各期数值理应同精度，整数夹在小数之间是脚注引用而非数据，丢弃（同港股管道
  // lineNumbers() 的脚注列处理思路，按 A 股这里实测的具体形态调整判定条件）。
  if (out.length >= 3 && !out[0].hasDecimal && Math.abs(out[0].value) < 1000 && out.slice(1).every((o) => o.hasDecimal)) {
    out.shift();
  }
  return out.map((o) => o.value);
}

// A 股定期报告三大报表（合并利润表/合并资产负债表/合并现金流量表）+ 报告摘要页
// 采用企业会计准则统一科目名称，全市场标签高度一致（不像港股各公司排版各异）。
// 银行/保险等金融业没有"营业成本"科目（毛利相关字段会诚实留空，不强行凑数）。
// 尾部可选括号（亏损标注/单位标注）用负向先行断言排除"括号内容恰好是单位词"的情况——
// 部分公司（如美的集团）把单位直接写进字段名括号里（"归属于上市公司股东的净利润
// （千元）"），若让这个可选组吞掉它，下面的内联单位识别就再也看不到，会把千元数值
// 当成元用（缩小 1000 倍）。真正的亏损标注（"亏损以'-'号填列"）内容不会恰好是单位词，
// 负向先行断言不影响那一类的正常吞括号行为。
const TRAILING_PAREN = "(?:[（(](?!(?:百万元|万元|千元|亿元|元)[）)])[^）)]*[）)])?";
/** @type {Array<[string, RegExp]>} */
const STATEMENT_FIELDS = [
  ["revenue", /^(其中[：:]\s*)?营业收入(?!\d)/],
  ["costOfRevenue", /^(其中[：:]\s*)?营业成本/],
  ["operatingIncome", new RegExp(`^[一二三四五六七八九十]*[、.]?\\s*营业利润${TRAILING_PAREN}`)],
  ["netIncome", new RegExp(`^[一二三四五六七八九十]*[、.]?\\s*净利润${TRAILING_PAREN}(?!率)`)],
  ["netIncomeAttributable", new RegExp(`^.*?归属于(母公司股东|上市公司股东)的净利润${TRAILING_PAREN}`)],
  ["eps", new RegExp(`^基本每股收益${TRAILING_PAREN}`)],
  ["operatingCashFlow", /^经营活动产生的现金流量净额/],
  ["cashAndEquivalents", /^货币资金/]
];

/**
 * 定期报告全文 → 关键财务行（纯函数）。
 * 返回 { currency, unit, unitLabel, fields, found }。数值已按检测到的单位换算成
 * 绝对币值；EPS 为每股值不做单位换算。fields 里每项是 { current, prior }
 * （A 股统一模板：本期在前、上年同期/上年度末在后，双栏或三栏[+变动%]都适用）。
 */
export function parseCnResultsText(rawText = "") {
  const lines = String(rawText).split("\n");

  const currency = "CNY";
  // 单位声明观察到四种词序："单位：元 币种：人民币"（茅台式，非金融业）、
  // "（货币单位：人民币百万元）"（平安银行式）、三大报表各自标题正下方"2025年度
  // 人民币千元"（中兴通讯式，无"单位"二字、无冒号）、"(除特别注明外，金额单位为
  // 人民币千元)"（美的集团合并利润表标题正下方，"单位"后面是"为"不是冒号）——
  // 同一份文档不同章节可能用不同单位（实测中兴通讯/美的集团都出现摘要页与正式
  // 合并三表单位不一致），不能整篇一次性正则，必须按行扫描做局部状态（同港股管道
  // parseResultsText 的单位处理思路：first-match-wins 的字段一旦命中在错误单位的
  // 章节，数值会差一到两个数量级——中兴通讯/美的集团的净利润都曾因此被放大过）。
  const UNIT_RE_LABELED = /(?:金额)?(?:货币)?单位[：:为]\s*(?:人民币)?\s*(百万元|万元|千元|亿元|元)/;
  // 裸声明只在短行（三大报表标题下方的期间+单位行，不是数据行）里识别，避免正文
  // 叙述句里偶然提到"人民币元"被误当单位切换。
  const UNIT_RE_BARE = /人民币(百万元|万元|千元|亿元|元)\s*$/;
  const UNIT_MAP = { 元: 1, 万元: 1e4, 千元: 1e3, 百万元: 1e6, 亿元: 1e8 };
  let unit = 1;
  let unitLabel = "元";

  const fields = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const unitMatch = line.match(UNIT_RE_LABELED) || (line.length <= 20 ? line.match(UNIT_RE_BARE) : null);
    if (unitMatch) {
      unit = UNIT_MAP[unitMatch[1]] ?? 1;
      unitLabel = unitMatch[1];
      continue;
    }

    for (const [key, pattern] of STATEMENT_FIELDS) {
      if (fields[key] !== undefined) continue;
      const m = line.match(pattern);
      if (!m) continue;
      let remainder = line.slice(m[0].length);
      // 部分公司（如美的集团）把单位直接写进字段名里而不是单独一行声明，如
      // "营业收入（千元）  456,451,731  407,149,600"——这个内联单位出现在正式
      // "单位：千元"声明行之前，按行扫描的 ambient unit 这时候还没更新，必须
      // 就地识别并覆盖，否则会用默认 unit=1 把千元数字当成元，缩小 1000 倍。
      let scale = unit;
      const inlineUnit = remainder.match(/^[（(](百万元|万元|千元|亿元|元)[）)]/);
      if (inlineUnit) {
        scale = UNIT_MAP[inlineUnit[1]] ?? unit;
        remainder = remainder.slice(inlineUnit[0].length);
      }
      const nums = numbersFromRemainder(remainder);
      if (!nums.length || nums.length > 4) continue; // 超过 4 栏基本是分部拆分表，跳过
      // EPS 是每股值，不做单位换算（同港股管道同一条规则：换算会把 2.07 元/股
      // 错乘成 2,070,000——单位声明只管绝对金额字段，不管每股指标）。
      if (key === "eps") scale = 1;
      fields[key] = { current: nums[0] * scale, prior: nums.length > 1 ? nums[1] * scale : null };
    }
  }

  // 毛利 = 营业收入 - 营业成本（两个真实披露数字相减，不是编造）；
  // 银行/保险没有营业成本科目，costOfRevenue 缺失时毛利诚实留空。
  if (fields.revenue && fields.costOfRevenue) {
    fields.grossProfit = {
      current: fields.revenue.current - fields.costOfRevenue.current,
      prior: fields.revenue.prior != null && fields.costOfRevenue.prior != null
        ? fields.revenue.prior - fields.costOfRevenue.prior
        : null
    };
  }

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
      headers: { "User-Agent": "Mozilla/5.0 EchoResearch/0.1 CNINFO filings pipeline" }
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
 * 摄取一只 A 股最近 N 份定期报告 → cn_financials。
 * 幂等：同 source_url 已入库则跳过（force 覆盖）。
 */
export async function ingestCnFinancials(ticker, { limit = 4, force = false } = {}) {
  const t = cnTicker(ticker);
  if (!isCN(t)) throw new Error(`${t} 不是 A 股，A 股管道不适用`);
  let announcements;
  try {
    announcements = await searchCninfoReportsAnnouncements(t);
  } catch (error) {
    await logIngestOutcome({ ticker: t, status: "search_failed", detail: error.message || String(error) });
    throw error;
  }
  const result = { ticker: t, ingested: [], skipped: [], errors: [] };

  for (const item of announcements.slice(0, limit)) {
    try {
      if (!force && await hasCnFinancialsForUrl(item.url)) {
        result.skipped.push(item.title);
        continue;
      }
      const pdfPath = join(CACHE_DIR, `${t.replace(/\W+/g, "_")}_${item.period.periodEnd}.pdf`);
      await downloadPdf(item.url, pdfPath);
      const text = await extractPdfText(pdfPath);
      const parsed = parseCnResultsText(text);
      if (!parsed.fields.revenue && !parsed.fields.netIncome) {
        throw new Error("解析不到营业收入/净利润行（可能非标准定期报告格式）");
      }
      // 可信度护栏：营收为负是不可能的真实财务状态（同港股管道同一条红线）。
      if (parsed.fields.revenue?.current < 0) {
        throw new Error(`解析到的营业收入为负（${parsed.fields.revenue.current}），疑似匹配到附注/分项表`);
      }
      const f = parsed.fields;
      await upsertCnFinancials({
        ticker: t,
        periodLabel: item.period.periodLabel,
        periodEnd: item.period.periodEnd,
        periodType: item.period.periodType,
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
        netCash: null, // A 股定期报告没有对应的单一"现金净额"科目，诚实留空（不强凑）
        sourceTitle: item.title,
        sourceUrl: item.url,
        publishedAt: item.publishedAt
      });
      // 全文进 documents 表，研究会话可引用原文段落。
      try {
        await addDocument({
          ticker: t,
          name: item.title,
          mimeType: "text/plain",
          size: text.length,
          parser: "extract_pdf_text",
          text: text.slice(0, 300000),
          sourceType: "cninfo-report",
          sourceUrl: item.url
        });
      } catch { /* 文档留档失败不影响主数据 */ }
      result.ingested.push({
        title: item.title,
        period: item.period.periodLabel,
        revenue: f.revenue?.current ?? null,
        netIncome: f.netIncome?.current ?? null,
        url: item.url
      });
    } catch (error) {
      result.errors.push(`${item.title}: ${error.message}`);
    }
  }
  await logIngestOutcome({
    ticker: t,
    status: classifyIngestStatus(announcements, result),
    detail: result.errors[0] || (announcements.length === 0 ? "巨潮资讯网未搜到定期报告（可能新上市/停牌/退市/代码有误）" : null),
    announcementsFound: announcements.length,
    ingestedCount: result.ingested.length
  });
  return result;
}

async function logIngestOutcome(entry) {
  try { await upsertCnFilingIngestLog(entry); } catch { /* 留痕失败不影响摄取结果本身 */ }
}

// ─── cn_financials 行 → financialsData 形状（纯函数） ────────────────

/**
 * 把最新一手行提升为 getFinancials 同形状的主财务对象，同 hkRowToFinancials 的角色。
 * 仅在第三方链路（东财/新浪/腾讯）全挂时作为主数据用；平时以 financialsData.cnFilings
 * 附挂，作为事实块的一手佐证。
 */
export function cnRowToFinancials(row) {
  const growth = (cur, prior) => (cur != null && prior ? Math.round(((cur - prior) / Math.abs(prior)) * 1000) / 10 : null);
  const margin = (part) => (row.revenue && part != null ? (part / row.revenue) * 100 : null);
  return {
    source: "巨潮资讯网定期报告（一手抽取）",
    ticker: row.ticker,
    period: row.period_label || row.period_end || "",
    currency: row.currency || "CNY",
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
    netCash: row.net_cash ?? null,
    asOf: row.extracted_at || new Date().toISOString(),
    providerStatus: "ok",
    firstParty: true,
    sourceUrl: row.source_url || null
  };
}

// ─── 后台刷新（研究请求不阻塞） ──────────────────────────────────────

const inflight = new Set();

export function refreshCnFinancialsInBackground(ticker) {
  const t = cnTicker(ticker);
  if (!isCN(t) || inflight.has(t)) return;
  inflight.add(t);
  ingestCnFinancials(t)
    .catch(() => { /* 后台任务失败静默，下次研究再触发 */ })
    .finally(() => inflight.delete(t));
}
