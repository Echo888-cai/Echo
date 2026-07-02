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
import { listCompanyProfiles } from "../repositories/companyProfiles.js";
import { macroWebEvidence, webEvidenceToPrompt } from "./webEvidenceService.js";
import { callModel, getProviderStatus } from "./modelGateway.js";
import { PROMPTS } from "../../prompts.js";
import { anchorQueryToDate, beijingYear, beijingDate } from "../utils/time.js";
import { withTimeout } from "../utils/async.js";

// ── 筛选条件解析（纯函数） ─────────────────────────────────

// 中文行业词 → FMP sector/industry。sector 用大类兜底，industry 只映射拿得准的枚举值。
const SECTOR_MAP = [
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

// FMP 批量报价（补 PE）：先试 stable 批量，再试 legacy v3；都不行就放弃（行里 PE 显示 —）。
async function enrichPe(rows) {
  const symbols = rows.map((r) => r.ticker).slice(0, 25);
  if (!symbols.length) return;
  let quotes = null;
  try {
    quotes = await fmpGet("/stable/batch-quote", { symbols: symbols.join(",") }, { ttl: FMP_TTL.fast, timeoutMs: 7000 });
  } catch {
    try {
      quotes = await fmpGet(`/api/v3/quote/${symbols.join(",")}`, {}, { ttl: FMP_TTL.fast, timeoutMs: 7000 });
    } catch { /* PE 补不上就诚实显示 — */ }
  }
  if (!Array.isArray(quotes)) return;
  const byTicker = new Map(quotes.map((q) => [String(q.symbol || "").toUpperCase(), q]));
  for (const row of rows) {
    const q = byTicker.get(row.ticker.toUpperCase());
    if (!q) continue;
    if (Number.isFinite(Number(q.pe))) row.pe = Number(Number(q.pe).toFixed(1));
    if (Number.isFinite(Number(q.price))) row.price = Number(q.price);
    if (Number.isFinite(Number(q.changesPercentage))) row.changePct = Number(Number(q.changesPercentage).toFixed(1));
  }
}

/** 跑筛选：FMP screener（美股）/ 本地池（港股）+ 已研究画像池 + 条件过滤。 */
export async function runScreener(question) {
  const filters = parseScreenerQuery(question);
  const notes = [...filters.ignored];
  let rows = [];

  if (filters.market === "US") {
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
    } catch (err) {
      notes.push(`FMP 筛选端点本轮不可用（${String(err.message || "").slice(0, 60)}），仅返回本地公司池`);
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
  rows.sort((a, b) => Number(b.researched) - Number(a.researched) || (b.mcap || 0) - (a.mcap || 0));

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
  return base
    .map((q) => anchorQueryToDate(q, question))
    .filter((q, i, arr) => arr.indexOf(q) === i);
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
