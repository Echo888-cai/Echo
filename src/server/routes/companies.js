/**
 * Company routes: search from 654 SQLite companies, detail view with data completeness.
 *
 * GET  /api/companies/search?q=           → search (SQLite 654)
 * GET  /api/companies/:ticker              → detail (with hasPortrait, recent market snapshot)
 * GET  /api/companies/:ticker/health       → data completeness
 */

import { sendOk, sendError } from "../utils/async.js";
import { searchCompanies, getCompanyByTickerComplete, getLatestMarketSnapshot } from "../repositories/companyRepository.js";

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
