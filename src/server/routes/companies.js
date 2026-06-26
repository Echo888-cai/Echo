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
// 明显不是普通股的名字（基金/ETF/信托/优先股/权证），名称兜底时排除。
const NON_EQUITY_HINT = /\b(ETF|Fund|Trust|Index|Preferred|Warrant|Units?|Notes?|Bond)\b/i;

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

// 校验美股代码是否真实存在于主板（防止模型把代码 hallucinate 出来张冠李戴）。
// 返回 { status: "verified"|"not_found"|"error", name? }。error（网络/限流）时上层选择信任模型。
async function verifyUsTicker(ticker) {
  let rows;
  try {
    rows = await fmpGet("/stable/search-symbol", { query: ticker }, { ttl: FMP_TTL.profile, timeoutMs: 5000 });
  } catch {
    return { status: "error" };
  }
  const hit = (Array.isArray(rows) ? rows : []).find(
    (r) => String(r.symbol).toUpperCase() === ticker.toUpperCase() && US_EXCHANGE_RANK[r.exchange] !== undefined
  );
  return hit ? { status: "verified", name: hit.name } : { status: "not_found" };
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
    // 1) 含拉丁字母 → 先走 FMP（英文名/拼音/代码命中率高，且不耗模型额度）。
    if (/[A-Za-z]/.test(query)) {
      const fmp = await fmpUsNameSearch(query);
      if (fmp) {
        sendOk(res, { company: { ticker: fmp.ticker, nameZh: fmp.name, nameEn: fmp.name, industry: "美股" } });
        return;
      }
    }
    // 2) LLM 解析（中文名主力路径；也兜住 FMP 漏掉的英文名）。
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
