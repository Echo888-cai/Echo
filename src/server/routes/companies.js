/**
 * Company routes: search from 654 SQLite companies, detail view with data completeness.
 *
 * GET  /api/companies/search?q=           → search (SQLite 654)
 * GET  /api/companies/resolve?q=          → intelligent resolve (FMP 英文 + LLM 中文 + 校验)
 * GET  /api/companies/:ticker              → detail (with hasPortrait, recent market snapshot)
 * GET  /api/companies/:ticker/health       → data completeness
 */

import { sendOk, sendError } from "../utils/async.js";
import { searchCompanies, getCompanyByTickerComplete, getLatestMarketSnapshot } from "../repositories/companyRepository.js";
import { fmpGet, FMP_TTL } from "../../fmpClient.js";
import { callModel, getProviderStatus } from "../services/modelGateway.js";

// 主板交易所优先级（越小越优先）。FMP 搜索会混进 OTC / 海外同名小票，按这个排序挑主板。
const US_EXCHANGE_RANK = { NASDAQ: 0, NYSE: 0, AMEX: 1, BATS: 2, CBOE: 2 };
// 明显不是普通股的名字（基金/ETF/信托/优先股/权证/杠杆反向产品），名称兜底时排除。
// 含杠杆/反向 ETF 发行商与措辞——否则搜 "SpaceX" 会撞到 "ProShares - Ultra SpaceX"(SPCF)
// 这类把热门公司名塞进产品名的衍生品，而不是正主。
const NON_EQUITY_HINT = /\b(ETF|ETN|Fund|Trust|Index|Preferred|Warrant|Units?|Notes?|Bond|ProShares|Direxion|Leveraged|Ultra(?:Pro|Short)?|[123]x|Bull|Bear|Inverse)\b/i;

// FMP 名称搜索：英文/拼音/代码 → 最佳美股主板普通股。返回 {ticker,name} 或 null。
async function fmpUsNameSearch(query) {
  let rows = [];
  try {
    rows = await fmpGet("/stable/search-name", { query }, { ttl: FMP_TTL.profile, timeoutMs: 6000 });
  } catch {
    return null;
  }
  const q = query.toLowerCase();
  const best = (Array.isArray(rows) ? rows : [])
    .filter((r) => r.symbol && r.name)
    .filter((r) => (r.currency || "USD") === "USD")
    .filter((r) => US_EXCHANGE_RANK[r.exchange] !== undefined)
    .filter((r) => !NON_EQUITY_HINT.test(r.name))
    .map((r) => {
      const sym = String(r.symbol).toUpperCase();
      const name = String(r.name);
      return { sym, name, score: [sym === q.toUpperCase() ? 0 : 1, name.toLowerCase().startsWith(q) ? 0 : 1, US_EXCHANGE_RANK[r.exchange], sym.includes(".") ? 1 : 0, sym.length] };
    })
    .sort((a, b) => {
      for (let i = 0; i < a.score.length; i += 1) {
        if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
      }
      return 0;
    })[0];
  return best ? { ticker: best.sym, name: best.name } : null;
}

// Finnhub 公司 profile：拿一个代码的官方名字 + 上市状态。FMP 免费档对刚 IPO 的新股
// 会 402 漏掉，但 Finnhub profile 有（含 ipo 日期）——这是"新上市自愈"的兜底校验源。
// 返回 { name } 或 null。
async function finnhubProfile(ticker) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${apiKey}`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!r.ok) return null;
    const data = await r.json();
    return data?.name ? { name: data.name } : null;
  } catch {
    return null;
  }
}

// Finnhub 符号搜索：把自由文本 → 候选代码。覆盖 FMP 名称搜索漏掉的新上市标的
// （如 "space exploration" → SPCX）。返回 result 数组。
async function finnhubSearch(query) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return [];
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${apiKey}`,
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data?.result) ? data.result : [];
  } catch {
    return [];
  }
}

// 校验美股代码是否真实存在于主板（防止模型把代码 hallucinate 出来张冠李戴）。
// 返回 { status: "verified"|"not_found"|"error", name? }。error（网络/限流）时上层选择信任模型。
// FMP search-symbol 是主校验；FMP 漏掉的新股（免费档 402）再用 Finnhub profile 兜底，
// 这样刚 IPO、模型/FMP 还没收录的代码也能被确认上市（"新上市自愈"）。
async function verifyUsTicker(ticker) {
  let rows;
  let fmpErrored = false;
  try {
    rows = await fmpGet("/stable/search-symbol", { query: ticker }, { ttl: FMP_TTL.profile, timeoutMs: 5000 });
  } catch {
    fmpErrored = true;
  }
  const hit = (Array.isArray(rows) ? rows : []).find(
    (r) => String(r.symbol).toUpperCase() === ticker.toUpperCase() && US_EXCHANGE_RANK[r.exchange] !== undefined
  );
  if (hit) return { status: "verified", name: hit.name };
  // FMP 没命中（新股 402 / 免费档不覆盖）→ Finnhub profile 兜底确认是否真上市。
  const prof = await finnhubProfile(ticker);
  if (prof) return { status: "verified", name: prof.name };
  return { status: fmpErrored ? "error" : "not_found" };
}

// 知名品牌 → 真实上市代码的别名。这不是"私人公司黑名单"（那种会过时、且会把已 IPO 的
// 公司错判成研究不了）——这里登记的是**已上市公司的真实代码**，而且每次都经下面的
// listing 探针实时校验：若某天退市/改名，校验失败会自动回退。只收录"搜索引擎按品牌词
// 撞名、搜不到正主"的高信号案例（如 SpaceX 搜出来是港股 Metaspacex / 杠杆 ETF）。
const BRAND_ALIASES = {
  spacex: "SPCX",
  "space x": "SPCX",
  太空探索: "SPCX",
  太空探索技术: "SPCX",
  "space exploration": "SPCX"
};

// 品牌别名 → 实时校验过的上市代码。**必须在 FMP 名称搜索之前**调用：这些品牌词正是
// FMP/搜索引擎会撞到衍生品/壳/同名小票的（"SpaceX"→杠杆 ETF SPCF、港股 Metaspacex），
// 先用别名锚定正主再实时校验，确认上市才返回。返回 {ticker,name} 或 null。
// 尾随的中文问句词/口语（"…怎么样""…最近如何""…股价"）。前端通常已剥净，但后端兜底
// 再剥一层，让别名走精确匹配——不用 substring 包含，避免 "Metaspacex"(1796.HK) 被
// "spacex" 误中这类真碰撞。
const TRAILING_QUERY_WORDS = /(怎么样|怎样|最近怎样|最近如何|如何|最近|现在|目前|股价|股票|行情|怎么看|值得买吗?|能买吗?|可以买吗?|贵不贵|怎么|呢|吗|的)+$/;

async function resolveBrandAlias(query) {
  const norm = String(query).trim().toLowerCase().replace(/\s+/g, " ");
  const stripped = norm.replace(TRAILING_QUERY_WORDS, "").trim();
  const aliasTicker =
    BRAND_ALIASES[norm] || BRAND_ALIASES[norm.replace(/\s+/g, "")] ||
    BRAND_ALIASES[stripped] || BRAND_ALIASES[stripped.replace(/\s+/g, "")];
  if (!aliasTicker) return null;
  const check = await verifyUsTicker(aliasTicker);
  return check.status === "verified" ? { ticker: aliasTicker, name: check.name || query } : null;
}

// Finnhub 符号搜索探针：覆盖 FMP 名称搜索漏掉的新上市标的（如 "space exploration" → SPCX）。
// 候选过 verifyUsTicker 实时校验，确认上市才返回。返回 {ticker,name} 或 null。
async function finnhubSearchProbe(query) {
  const rows = await finnhubSearch(query);
  const cand = rows.find(
    (r) => r.symbol && !String(r.symbol).includes(".") && /common stock/i.test(r.type || "Common Stock")
  );
  if (!cand) return null;
  const check = await verifyUsTicker(String(cand.symbol).toUpperCase());
  return check.status === "verified"
    ? { ticker: String(cand.symbol).toUpperCase(), name: check.name || cand.description || query }
    : null;
}

// 港股代码标准化：700 / 0700 / 0700.HK → 0700.HK。识别不出返回 ""。
function normalizeHkTicker(raw = "") {
  const m = String(raw).toUpperCase().match(/(\d{1,5})/);
  return m ? `${m[1].padStart(4, "0")}.HK` : "";
}

// 从模型输出里抠出第一个 JSON 对象（容忍 ```json 包裹和前后解释）。
function parseModelJson(text = "") {
  const fenced = String(text).replace(/```json|```/gi, " ");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch {
    return null;
  }
}

const RESOLVER_SYSTEM =
  "你是股票代码解析器。用户给一个公司名（中文/英文/拼音/简称），判断它对应的上市公司。" +
  "只输出 JSON，不要解释、不要 markdown。格式：" +
  '{"ticker":"美股直接代码如 LRCX；港股用四位数字.HK 如 0700.HK；A股用 6 位数字.SS 或 .SZ","market":"US|HK|CN","nameZh":"中文简称","confident":true或false}。' +
  "规则：若同一家公司在美股有 ADR（如台积电 TSM、阿里巴巴 BABA），优先返回美股代码。" +
  "若不是上市公司、查不到、或你没有把握，ticker 用空字符串、confident 用 false。";

// 用 LLM 把公司名解析成代码，并对结果做校验/标准化。返回标准 company 或 {reason}。
async function llmResolveCompany(query) {
  if (!getProviderStatus().configured) return { reason: "no_model" };
  let res;
  try {
    res = await callModel({ system: RESOLVER_SYSTEM, user: `公司名：${query}` });
  } catch {
    return { reason: "model_error" };
  }
  const parsed = parseModelJson(res?.content || "");
  if (!parsed || !parsed.confident || !parsed.ticker) return { reason: "unknown" };
  const market = String(parsed.market || "").toUpperCase();
  const nameZh = parsed.nameZh || query;

  if (market === "US") {
    const ticker = String(parsed.ticker).toUpperCase().trim();
    if (!/^[A-Z][A-Z.\-]{0,6}$/.test(ticker)) return { reason: "unknown" };
    const check = await verifyUsTicker(ticker);
    if (check.status === "not_found") return { reason: "unknown" }; // 模型把代码编错了 → 当作没识别出
    return { company: { ticker, nameZh: check.name || nameZh, nameEn: check.name || "", industry: "美股" } };
  }
  if (market === "HK") {
    const ticker = normalizeHkTicker(parsed.ticker);
    if (!ticker) return { reason: "unknown" };
    return { company: { ticker, nameZh, industry: "港股" } };
  }
  if (market === "CN") {
    return { reason: "cn_unsupported", name: nameZh }; // Luvio 目前只做港股+美股
  }
  return { reason: "unknown" };
}

/** Determine which columns are populated for a company. */
function computeDataHealth(company) {
  if (!company) return { total: 0, complete: 0, missing: [], hasPortrait: false };
  const checks = [
    { key: "hq_price", label: "实时价格", ok: !!company.price },
    { key: "hq_pe", label: "历史 PE", ok: !!company.pe },
    { key: "hq_pb", label: "历史 PB", ok: !!company.pb },
    { key: "profile_summary", label: "公司概况", ok: !!(company.summary?.length) },
    { key: "profile_biz", label: "商业模式", ok: !!(company.businessModel?.length) },
    { key: "profile_risks", label: "风险点", ok: !!(company.risks?.length) },
    { key: "profile_monitors", label: "监控指标", ok: !!(company.monitors?.length) },
    { key: "profile_moat", label: "护城河", ok: !!(company.moat?.length) },
    { key: "profile_management", label: "管理层", ok: !!(company.management?.length) },
    { key: "profile_sources", label: "来源信息", ok: !!(company.officialSources?.length) }
  ];
  const done = checks.filter((c) => c.ok);
  const missing = checks.filter((c) => !c.ok).map((c) => c.label);
  return {
    total: checks.length,
    complete: done.length,
    missing,
    hasPortrait: done.length >= 5,
    items: checks
  };
}

export async function handleCompanySearch(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const query = url.searchParams.get("q") || "";
    if (!query.trim()) {
      sendOk(res, { companies: [], total: 0 });
      return;
    }
    const results = searchCompanies(query);
    sendOk(res, { companies: results, total: results.length });
  } catch (error) {
    sendError(res, 500, error.message || "搜索失败");
  }
}

/**
 * 智能公司解析。前端别名表 / 港股库 / 代码 全没命中时的兜底，两条腿：
 *   1. 英文/拼音/代码 → FMP 名称搜索（快、免费、覆盖全美股主板）。
 *   2. 中文名（FMP 不认中文）→ LLM 解析出代码（如 泛林集团→LRCX、商汤→0020.HK），
 *      美股代码再用 FMP 校验存在性，防止模型 hallucinate 张冠李戴。
 * 返回：
 *   { company }                         成功
 *   { company: null }                   识别不出
 *   { company: null, reason, name }     特殊情况（如 A 股暂不支持 cn_unsupported）
 */
export async function handleCompanyResolve(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const query = (url.searchParams.get("q") || "").trim();
    if (query.length < 2) {
      sendOk(res, { company: null });
      return;
    }
    // 1) 品牌别名（实时校验过的上市代码）。必须最先——这些词 FMP/搜索引擎会撞衍生品/壳
    //    （"SpaceX"→杠杆 ETF SPCF），先锚定正主。这是 SpaceX→SPCX 能识别的关键。
    const alias = await resolveBrandAlias(query);
    if (alias) {
      sendOk(res, { company: { ticker: alias.ticker, nameZh: alias.name, nameEn: alias.name, industry: "美股" } });
      return;
    }
    // 2) 含拉丁字母 → 走 FMP（英文名/拼音/代码命中率高，且不耗模型额度）。
    if (/[A-Za-z]/.test(query)) {
      const fmp = await fmpUsNameSearch(query);
      if (fmp) {
        sendOk(res, { company: { ticker: fmp.ticker, nameZh: fmp.name, nameEn: fmp.name, industry: "美股" } });
        return;
      }
    }
    // 3) Finnhub 符号搜索探针（实时上市校验）。覆盖 FMP 名称搜索漏掉的新上市标的。
    const probed = await finnhubSearchProbe(query);
    if (probed) {
      sendOk(res, { company: { ticker: probed.ticker, nameZh: probed.name, nameEn: probed.name, industry: "美股" } });
      return;
    }
    // 4) LLM 解析（中文名主力路径；也兜住 FMP 漏掉的英文名）。
    const llm = await llmResolveCompany(query);
    sendOk(res, llm.company ? { company: llm.company } : { company: null, reason: llm.reason, name: llm.name });
  } catch (error) {
    sendError(res, 500, error.message || "公司解析失败");
  }
}

export async function handleCompanyByTicker(req, res, ticker) {
  try {
    if (!ticker) {
      sendError(res, 400, "缺少 ticker");
      return;
    }
    const company = getCompanyByTickerComplete(ticker);
    if (!company) {
      sendError(res, 404, `未找到公司 ${ticker}`);
      return;
    }
    const health = computeDataHealth(company);
    const snapshot = getLatestMarketSnapshot(ticker);
    sendOk(res, {
      company,
      health,
      latestMarketSnapshot: snapshot
        ? { price: snapshot.price, source: snapshot.source, asOf: snapshot.as_of, stale: true }
        : null
    });
  } catch (error) {
    sendError(res, 500, error.message || "获取公司信息失败");
  }
}

export async function handleCompanyHealth(req, res, ticker) {
  try {
    if (!ticker) {
      sendError(res, 400, "缺少 ticker");
      return;
    }
    const company = getCompanyByTickerComplete(ticker);
    if (!company) {
      sendError(res, 404, `未找到公司 ${ticker}`);
      return;
    }
    const health = computeDataHealth(company);
    sendOk(res, { health });
  } catch (error) {
    sendError(res, 500, error.message || "获取数据健康失败");
  }
}
