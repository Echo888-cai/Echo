/**
 * P6 发现层：筛选器（screener）+ 宏观路由（macro）。
 *
 * 两类"不绑定单一公司"的问题从公司研究管道分流到这里：
 * - screener："帮我筛美股半导体 PE<20" → 解析条件 → FMP company-screener（免费档）
 *   + 本地公司池/已研究画像 → 结果名单（前端渲染表格 + 一键开研究）。
 * - macro："美股今晚有什么关键事件" → 指数行情（SPX/NDX/DJI/HSI，免费源）
 *   + 宏观网页证据 + 宏观提示词模板 → 一段有据可依的宏观短评。
 *
 * 纯函数（parseScreenerQuery / buildMacroQueries / pickIndices）不碰网络，进 tests/phase6.mjs。
 */
import { fmpGet, FMP_TTL } from "../../fmpClient.js";
import { companies } from "../../data.js";
import { getFinancials } from "../../financialData.js";
import { computeFinancialQuality } from "./financialQuality.js";
import { listCompanyProfiles } from "../repositories/companyProfiles.js";
import { macroWebEvidence, webEvidenceToPrompt } from "./webEvidenceService.js";
import { callModel, getProviderStatus } from "./modelGateway.js";
import { PROMPTS } from "../../prompts.js";
import { beijingYear, beijingDate } from "../utils/time.js";
import { withTimeout } from "../utils/async.js";

// ── 筛选条件解析（纯函数） ─────────────────────────────────

// 中文行业词 → FMP sector/industry。sector 用大类兜底，industry 只映射拿得准的枚举值。
// EA-3：细分赛道（光模块/CPO、液冷、存储/HBM、EDA、半导体设备）没有对应的 FMP industry
// 枚举值，关键词匹配也太粗——FMP 的 "Semiconductors" 装不下"存储芯片"这种主题。这类条目
// 带 tickers（HK/US 已上市龙头名单兜底），runScreener 命中时直接用这份名单起筛，而不是
// 硬套一个匹配不上的 industry 枚举。放在通用大类（半导体/科技）前面，保证优先命中。
/** @type {Array<[RegExp, {label: string, sector?: string, industry?: string, tickers?: Array<{ticker: string, name: string}>}]>} */
const SECTOR_MAP = [
  [/光模块|光互联|CPO|光通信/i, {
    label: "光模块/光通信",
    tickers: [
      { ticker: "COHR", name: "Coherent Corp." },
      { ticker: "LITE", name: "Lumentum Holdings" },
      { ticker: "FN", name: "Fabrinet" },
      { ticker: "CIEN", name: "Ciena Corporation" }
    ]
  }],
  [/液冷|散热|热管理/, {
    label: "液冷/数据中心热管理",
    tickers: [
      { ticker: "VRT", name: "Vertiv Holdings" },
      { ticker: "NVT", name: "nVent Electric" }
    ]
  }],
  [/存储芯片|HBM|内存芯片/i, {
    label: "存储芯片/HBM",
    tickers: [
      { ticker: "MU", name: "Micron Technology" },
      { ticker: "WDC", name: "Western Digital" },
      { ticker: "STX", name: "Seagate Technology" }
    ]
  }],
  [/\bEDA\b|芯片设计软件/i, {
    label: "EDA",
    tickers: [
      { ticker: "SNPS", name: "Synopsys" },
      { ticker: "CDNS", name: "Cadence Design Systems" }
    ]
  }],
  [/半导体设备|光刻机|刻蚀设备/, {
    label: "半导体设备",
    tickers: [
      { ticker: "ASML", name: "ASML Holding" },
      { ticker: "AMAT", name: "Applied Materials" },
      { ticker: "LRCX", name: "Lam Research" },
      { ticker: "KLAC", name: "KLA Corporation" }
    ]
  }],
  [/半导体|芯片/, { industry: "Semiconductors", label: "半导体" }],
  [/生物科技|创新药/, { industry: "Biotechnology", label: "生物科技" }],
  [/汽车|车企/, { industry: "Auto Manufacturers", label: "汽车" }],
  [/军工|航空航天|国防/, { industry: "Aerospace & Defense", label: "航空航天与国防" }],
  [/软件|SaaS/i, { sector: "Technology", label: "科技（软件）" }],
  [/科技|互联网/, { sector: "Technology", label: "科技" }],
  [/医药|制药|医疗/, { sector: "Healthcare", label: "医疗健康" }],
  [/银行|金融|券商|保险/, { sector: "Financial Services", label: "金融" }],
  [/能源|石油|油气/, { sector: "Energy", label: "能源" }],
  [/消费|零售/, { sector: "Consumer Cyclical", label: "消费" }],
  [/公用事业|电力水务/, { sector: "Utilities", label: "公用事业" }],
  [/地产|房地产/, { sector: "Real Estate", label: "地产" }],
  [/工业|制造/, { sector: "Industrials", label: "工业" }],
  [/通信|电信/, { sector: "Communication Services", label: "通信" }]
];

const LT = /(小于|低于|不到|少于|以下|<|＜|≤)/;
const GT = /(大于|高于|超过|多于|以上|>|＞|≥)/;

function numAfter(text, keyRe) {
  // "PE小于20" / "PE < 20" / "市值大于500亿"
  const re = new RegExp(`${keyRe.source}\\s*(?:${LT.source}|${GT.source})\\s*([0-9]+(?:\\.[0-9]+)?)`, "i");
  const m = text.match(re);
  if (!m) return null;
  const isLt = new RegExp(`${keyRe.source}\\s*${LT.source}`, "i").test(text);
  return { value: Number(m[m.length - 1]), op: isLt ? "lt" : "gt" };
}

// 市值单位：亿（默认美元亿）/ 千亿 / 万亿。返回美元绝对值。
function marketCapFrom(text) {
  const m = text.match(new RegExp(`市值\\s*(?:${LT.source}|${GT.source})\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(万亿|千亿|百亿|亿)`, "i"));
  if (!m) return null;
  const isLt = new RegExp(`市值\\s*${LT.source}`).test(text);
  const unit = m[m.length - 1];
  const mult = unit === "万亿" ? 1e12 : unit === "千亿" ? 1e11 : unit === "百亿" ? 1e10 : 1e8;
  return { value: Number(m[m.length - 2]) * mult, op: isLt ? "lt" : "gt" };
}

/** 把自然语言筛选句解析成结构化条件。纯函数，可测。 */
export function parseScreenerQuery(question = "") {
  const text = String(question || "");
  const market = /港股|香港/.test(text) && !/美股/.test(text) ? "HK" : "US";
  const sectorHit = SECTOR_MAP.find(([re]) => re.test(text));
  const pe = numAfter(text, /(?:PE|市盈率)/i);
  const price = numAfter(text, /(?:价格|股价|现价)/);
  const mcap = marketCapFrom(text);
  const ignored = [];
  if (/股息|分红/.test(text)) ignored.push("股息率筛选（免费数据档暂不支持，已忽略该条件）");
  if (/(营收增速|增速|增长率)/.test(text)) ignored.push("增速筛选（需逐家财报，暂不支持，已忽略该条件）");
  return {
    market,
    sector: sectorHit ? sectorHit[1].sector || null : null,
    industry: sectorHit ? sectorHit[1].industry || null : null,
    sectorLabel: sectorHit ? sectorHit[1].label : null,
    peMax: pe && pe.op === "lt" ? pe.value : null,
    peMin: pe && pe.op === "gt" ? pe.value : null,
    priceMax: price && price.op === "lt" ? price.value : null,
    priceMin: price && price.op === "gt" ? price.value : null,
    mcapMin: mcap && mcap.op === "gt" ? mcap.value : null,
    mcapMax: mcap && mcap.op === "lt" ? mcap.value : null,
    // EA-3：命中的细分赛道自带 HK/US 龙头名单时，直接用这份名单起筛（FMP industry 枚举
    // 装不下"存储芯片""光模块"这类主题词）。
    curatedTickers: sectorHit && Array.isArray(sectorHit[1].tickers) ? sectorHit[1].tickers : null,
    ignored
  };
}

// 本地已研究画像池：sector/industry/名称 命中筛选行业词的已研究公司（任何市场）。
function researchedPool(filters) {
  let profiles;
  try {
    profiles = listCompanyProfiles(60) || [];
  } catch {
    return [];
  }
  return profiles
    .map((p) => {
      const c = companies.find((x) => x.ticker === p.ticker) || {};
      return {
        ticker: p.ticker,
        name: p.companyName || c.nameZh || p.ticker,
        sector: c.sector || "",
        industry: c.industry || "",
        researched: true
      };
    })
    .filter((row) => {
      if (!filters.sectorLabel) return true; // 没点名行业：已研究池全部给出（供参考）
      const hay = `${row.sector} ${row.industry} ${row.name}`;
      const [re] = SECTOR_MAP.find(([, v]) => v.label === filters.sectorLabel) || [null];
      return re ? re.test(hay) : true;
    })
    .slice(0, 8);
}

// 本地港股池（免费档 FMP 不覆盖港股）：按行业词过滤 seed 公司列表。
function localHkPool(filters) {
  const [re] = filters.sectorLabel
    ? (SECTOR_MAP.find(([, v]) => v.label === filters.sectorLabel) || [null])
    : [null];
  return companies
    .filter((c) => /\.HK$/.test(c.ticker))
    .filter((c) => (re ? re.test(`${c.sector} ${c.industry} ${c.nameZh}`) : true))
    .slice(0, 12)
    .map((c) => ({ ticker: c.ticker, name: c.nameZh, sector: c.sector || "", industry: c.industry || "", researched: false }));
}

// FMP 批量报价（补 PE + 市值）：先试 stable 批量，再试 legacy v3；都不行就放弃（行里显示 —）。
async function enrichPe(rows) {
  const symbols = rows.map((r) => r.ticker).slice(0, 25);
  if (!symbols.length) return;
  let quotes = null;
  try {
    quotes = await fmpGet("/stable/batch-quote", { symbols: symbols.join(",") }, { ttl: FMP_TTL.fast, timeoutMs: 7000 });
  } catch {
    try {
      quotes = await fmpGet(`/api/v3/quote/${symbols.join(",")}`, {}, { ttl: FMP_TTL.fast, timeoutMs: 7000 });
    } catch { /* PE/市值补不上就诚实显示 — */ }
  }
  if (!Array.isArray(quotes)) return;
  const byTicker = new Map(quotes.map((q) => [String(q.symbol || "").toUpperCase(), q]));
  for (const row of rows) {
    const q = byTicker.get(row.ticker.toUpperCase());
    if (!q) continue;
    if (Number.isFinite(Number(q.pe))) row.pe = Number(Number(q.pe).toFixed(1));
    if (Number.isFinite(Number(q.price))) row.price = Number(q.price);
    if (Number.isFinite(Number(q.changesPercentage))) row.changePct = Number(Number(q.changesPercentage).toFixed(1));
    if (row.mcap == null && Number.isFinite(Number(q.marketCap))) row.mcap = Number(q.marketCap);
  }
}

// EA-3：细分赛道命中 SECTOR_MAP 的 curatedTickers 时，直接用这份 HK/US 已上市龙头名单
// 起筛——不是穷举全市场，是"这个主题目前能给的、真实存在的对照名单"。
function curatedPool(tickers) {
  return tickers.map((t) => ({
    ticker: t.ticker,
    name: t.name,
    sector: "",
    industry: "",
    mcap: null,
    price: null,
    pe: null,
    researched: false
  }));
}

// EA-3："值得买" = 可解释排序，不是只按市值堆。对候选池里最多 8 家跑一轮财务质量打分
// （并发 + 单家超时保护），按 qualityScore 从高到低重排，每行附一句"为什么排这里"；
// 拿不到财务数据的行保留原有市值/已研究排序，reason 诚实写"未核到，按市值排序"。
async function rankByQuality(rows) {
  const candidates = rows.slice(0, 8);
  const scored = await Promise.all(
    candidates.map(async (row) => {
      const financials = await withTimeout(getFinancials(row.ticker), 6000, { providerStatus: "missing" });
      return { ticker: row.ticker, quality: computeFinancialQuality(financials).quality };
    })
  );
  const byTicker = new Map(scored.map((s) => [s.ticker, s]));
  for (const row of rows) {
    const s = byTicker.get(row.ticker);
    if (!s || s.quality.qualityScore == null) {
      row.qualityScore = null;
      row.reason = row.researched ? "已研究，按市值排序" : "财务数据未核，按市值排序";
      continue;
    }
    row.qualityScore = s.quality.qualityScore;
    const bits = [];
    if (s.quality.revenueGrowth != null) bits.push(`收入增速 ${s.quality.revenueGrowth.toFixed(1)}%`);
    if (s.quality.grossMargin != null) bits.push(`毛利率 ${s.quality.grossMargin.toFixed(1)}%`);
    row.reason = `利润质量 ${s.quality.qualityScore}/100${bits.length ? `（${bits.join("、")}）` : ""}`;
  }
  rows.sort((a, b) => {
    if (a.qualityScore != null && b.qualityScore != null) return b.qualityScore - a.qualityScore;
    if (a.qualityScore != null) return -1;
    if (b.qualityScore != null) return 1;
    return Number(b.researched) - Number(a.researched) || (b.mcap || 0) - (a.mcap || 0);
  });
  return rows;
}

/** 跑筛选：FMP screener（美股）/ 细分赛道龙头名单 / 本地池（港股）+ 已研究画像池 + 条件过滤 + 可解释排序。 */
export async function runScreener(question) {
  const filters = parseScreenerQuery(question);
  const notes = [...filters.ignored];
  let rows = [];

  if (filters.market === "US") {
    if (filters.curatedTickers) {
      rows = curatedPool(filters.curatedTickers);
      await withTimeout(enrichPe(rows), 8000, null);
      notes.push(`"${filters.sectorLabel}"是细分主题，免费筛选器覆盖不到——名单来自已知 HK/US 上市龙头，非全市场穷举`);
    } else {
      const params = { isActivelyTrading: true, limit: 40, exchange: "NYSE,NASDAQ" };
      if (filters.sector) params.sector = filters.sector;
      if (filters.industry) params.industry = filters.industry;
      if (filters.mcapMin) params.marketCapMoreThan = Math.round(filters.mcapMin);
      if (filters.mcapMax) params.marketCapLowerThan = Math.round(filters.mcapMax);
      if (filters.priceMin) params.priceMoreThan = filters.priceMin;
      if (filters.priceMax) params.priceLowerThan = filters.priceMax;
      try {
        const data = await fmpGet("/stable/company-screener", params, { ttl: FMP_TTL.estimates, timeoutMs: 9000 });
        rows = (Array.isArray(data) ? data : [])
          .filter((r) => r.symbol && !r.isEtf)
          .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
          .slice(0, 20)
          .map((r) => ({
            ticker: String(r.symbol).toUpperCase(),
            name: r.companyName || r.symbol,
            sector: r.sector || "",
            industry: r.industry || "",
            mcap: Number.isFinite(Number(r.marketCap)) ? Number(r.marketCap) : null,
            price: Number.isFinite(Number(r.price)) ? Number(r.price) : null,
            pe: null,
            researched: false
          }));
        // PE 是筛选高频条件但 screener 原生不带 → 批量报价补一轮（best-effort）。
        await withTimeout(enrichPe(rows), 8000, null);
      } catch (err) {
        notes.push(`FMP 筛选端点本轮不可用（${String(err.message || "").slice(0, 60)}），仅返回本地公司池`);
      }
    }
    if (filters.peMax != null || filters.peMin != null) {
      const before = rows.length;
      rows = rows.filter((r) => {
        if (r.pe == null || r.pe <= 0) return false; // PE 条件下，取不到 PE/亏损的剔除
        if (filters.peMax != null && r.pe > filters.peMax) return false;
        if (filters.peMin != null && r.pe < filters.peMin) return false;
        return true;
      });
      if (!rows.length && before) notes.push("PE 数据本轮未取到或全部不满足条件，名单可能偏少");
    }
  } else {
    rows = localHkPool(filters);
    notes.push("港股免费数据档没有全市场筛选器，名单来自本地公司池（按行业匹配），估值条件请点开个股核实");
  }

  // 已研究池：标记/补充（去重，researched 优先展示在前）。
  const researched = researchedPool(filters);
  const seen = new Set(rows.map((r) => r.ticker));
  for (const r of rows) {
    if (researched.some((p) => p.ticker === r.ticker)) r.researched = true;
  }
  const extra = researched.filter((p) => !seen.has(p.ticker));
  rows = [...rows, ...extra].slice(0, 20);

  // EA-3：财务质量重排 + 逐行"为什么排这里"。超时兜底：拿不到就保留市值/已研究序，不阻塞返回。
  rows = await withTimeout(rankByQuality(rows), 10000, rows);

  return { kind: "screener", filters, rows, notes };
}

// ── 宏观 ──────────────────────────────────────────────────

/** 按问题选指数组（纯函数，可测）。 */
export function pickIndices(question = "") {
  const text = String(question || "");
  const hk = /港股|恒指|恒生/.test(text);
  const us = /美股|纳指|纳斯达克|标普|道指|美联储|非农|CPI/.test(text);
  if (hk && !us) return ["HSI", "HSCEI"];
  if (us && !hk) return ["SPX", "NDX", "DJI"];
  return ["SPX", "NDX", "HSI"];
}

/** 宏观检索词（纯函数，可测）：中英混合 + 日期锚定。 */
export function buildMacroQueries(question = "") {
  const year = beijingYear();
  const text = String(question || "");
  const hkFocus = /港股|恒指|恒生/.test(text) && !/美股/.test(text);
  const base = hkFocus
    ? [
        `Hong Kong stock market Hang Seng outlook key events this week ${year}`,
        `港股 恒生指数 本周 关键事件 展望`,
        `China policy Hong Kong stocks catalysts ${year}`
      ]
    : [
        `US stock market key events this week Fed earnings economic data ${year}`,
        `美股 本周 关键事件 财报 美联储 数据`,
        `S&P 500 Nasdaq outlook catalysts ${year}`
      ];
  return base.filter((q, i, arr) => arr.indexOf(q) === i);
}

// 指数行情全部走腾讯免费源（无 Key、美/港指数都覆盖；Yahoo v8 无浏览器 UA 会 403）。
// 字段布局与个股相同：fields[3]=现价，fields[32]=涨跌幅%。
const INDEX_DEFS = {
  SPX: { label: "标普 500", tencent: "usINX" },
  NDX: { label: "纳指 100", tencent: "usNDX" },
  DJI: { label: "道琼斯", tencent: "usDJI" },
  HSI: { label: "恒生指数", tencent: "hkHSI" },
  HSCEI: { label: "国企指数", tencent: "hkHSCEI" }
};

async function fetchIndexQuote(key) {
  const def = INDEX_DEFS[key];
  if (!def) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(`https://qt.gtimg.cn/q=${def.tencent}`, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 Echo/0.1", Accept: "text/plain,*/*" }
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`${resp.status}`);
    const fields = (text.match(/="(.+)";?\s*$/) || [])[1]?.split("~") || [];
    const price = Number(fields[3]);
    if (!Number.isFinite(price)) return null;
    return { key, label: def.label, price, changePct: Number.isFinite(Number(fields[32])) ? Number(fields[32]) : null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function indicesToPrompt(indices) {
  const ok = indices.filter(Boolean);
  if (!ok.length) return "指数行情：本轮未取到实时指数。";
  return `指数行情（实时）：\n${ok.map((i) => `- ${i.label}：${i.price}${i.changePct != null ? `（${i.changePct > 0 ? "+" : ""}${i.changePct}%）` : ""}`).join("\n")}`;
}

// 模型不可用时的本地兜底：指数 + 证据标题列表，诚实、不装判断。
function localMacroAnswer(indices, webEvidence) {
  const parts = [];
  const ok = indices.filter(Boolean);
  if (ok.length) {
    parts.push("简单说");
    parts.push(ok.map((i) => `${i.label} ${i.price}${i.changePct != null ? `（${i.changePct > 0 ? "+" : ""}${i.changePct}%）` : ""}`).join("；") + "。");
  }
  const ev = webEvidence?.evidence || [];
  if (ev.length) {
    parts.push("已抓到的外部信号");
    for (const e of ev.slice(0, 5)) parts.push(`- [${e.title}](${e.url})${e.publishedAt ? `（${e.publishedAt}）` : ""}`);
  }
  parts.push("数据缺口");
  parts.push("本地模式（未配置模型 Key）：只能给指数与线索清单，事件解读请点开来源核实。");
  return parts.join("\n");
}

/** 跑宏观：指数行情 + 宏观证据 + 模型短评（无模型时本地兜底）。 */
export async function runMacro(question) {
  const keys = pickIndices(question);
  const queries = buildMacroQueries(question);
  const [indices, webEvidence] = await Promise.all([
    Promise.all(keys.map((k) => withTimeout(fetchIndexQuote(k), 6000, null))),
    withTimeout(macroWebEvidence({ question, queries }), 14000, { intent: "macro", queries, evidence: [], gaps: ["宏观证据检索超时"], provider: "timeout", searchedAt: new Date().toISOString() })
  ]);

  let content = null;
  let mode = "local_fallback";
  if (getProviderStatus().configured) {
    try {
      // 当前日期显式锚定：证据稀薄时模型最容易把"今天"编错，这里不给它猜的空间。
      const user = [
        `今天是北京时间 ${beijingDate()}。日期以此为准，禁止使用其他日期作为"当前时间"。`,
        `用户问题：${question}`,
        "",
        indicesToPrompt(indices),
        "",
        webEvidenceToPrompt(webEvidence)
      ].join("\n");
      const result = await callModel({ system: PROMPTS.macro.system, user });
      if (result?.content && result.content.length > 40) {
        content = result.content;
        mode = "model";
      }
    } catch { /* 落回本地 */ }
  }
  if (!content) content = localMacroAnswer(indices, webEvidence);

  return {
    kind: "macro",
    content,
    mode,
    indices: indices.filter(Boolean),
    evidence: (webEvidence.evidence || []).slice(0, 6).map((e) => ({
      title: e.title,
      url: e.url,
      source: e.source,
      type: e.sourceType || "web",
      cred: e.credibilityScore ?? null,
      date: e.publishedAt || ""
    })),
    gaps: webEvidence.gaps || []
  };
}
