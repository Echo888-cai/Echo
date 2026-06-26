/**
 * Company routes: search from 654 SQLite companies, detail view with data completeness.
 *
 * GET  /api/companies/search?q=           → search (SQLite 654)
 * GET  /api/companies/:ticker              → detail (with hasPortrait, recent market snapshot)
 * GET  /api/companies/:ticker/health       → data completeness
 */

import { sendOk, sendError } from "../utils/async.js";
import { searchCompanies, getCompanyByTickerComplete, getLatestMarketSnapshot } from "../repositories/companyRepository.js";
import { fmpGet, FMP_TTL } from "../../fmpClient.js";

// 主板交易所优先级（越小越优先）。FMP 搜索会混进 OTC / 海外同名小票，按这个排序挑主板。
const US_EXCHANGE_RANK = { NASDAQ: 0, NYSE: 0, AMEX: 1, BATS: 2, CBOE: 2 };
// 明显不是普通股的名字（基金/ETF/信托/优先股/权证），名称兜底时排除。
const NON_EQUITY_HINT = /\b(ETF|Fund|Trust|Index|Preferred|Warrant|Units?|Notes?|Bond)\b/i;

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
 * US 名称/拼音/代码 → 最佳主板普通股。中文名命中不了前端别名表时的兜底（FMP 搜索
 * 不认中文，所以这里只处理英文名/拼音/代码）。挑选规则：主板优先、ticker 不含点、
 * 名称越接近查询越靠前，排除 ETF/基金等非普通股。识别不到返回 company:null（让前端
 * 据此明确告诉用户"没识别出这家公司"，而不是张冠李戴沿用上一家）。
 */
export async function handleUsCompanySearch(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const query = (url.searchParams.get("q") || "").trim();
    if (query.length < 2) {
      sendOk(res, { company: null });
      return;
    }
    let rows = [];
    try {
      rows = await fmpGet("/stable/search-name", { query }, { ttl: FMP_TTL.profile, timeoutMs: 6000 });
    } catch {
      sendOk(res, { company: null, reason: "search_unavailable" });
      return;
    }
    const q = query.toLowerCase();
    const candidates = (Array.isArray(rows) ? rows : [])
      .filter((r) => r.symbol && r.name)
      .filter((r) => (r.currency || "USD") === "USD")
      .filter((r) => US_EXCHANGE_RANK[r.exchange] !== undefined)
      .filter((r) => !NON_EQUITY_HINT.test(r.name))
      .map((r) => {
        const sym = String(r.symbol).toUpperCase();
        const name = String(r.name);
        const exactSym = sym === q.toUpperCase() ? 0 : 1;
        const nameStarts = name.toLowerCase().startsWith(q) ? 0 : 1;
        const hasDot = sym.includes(".") ? 1 : 0; // 外国上市同名（如 .TA / .DE）排后
        return { sym, name, score: [exactSym, nameStarts, US_EXCHANGE_RANK[r.exchange], hasDot, sym.length] };
      })
      .sort((a, b) => {
        for (let i = 0; i < a.score.length; i += 1) {
          if (a.score[i] !== b.score[i]) return a.score[i] - b.score[i];
        }
        return 0;
      });
    const best = candidates[0];
    sendOk(res, { company: best ? { ticker: best.sym, nameZh: best.name, nameEn: best.name, industry: "美股" } : null });
  } catch (error) {
    sendError(res, 500, error.message || "美股搜索失败");
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
