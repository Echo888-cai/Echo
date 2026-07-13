/** HTTP adapters for company search, verification, resolution and detail. */
import { sendError, sendOk } from "../utils/async.js";
import {
  getCompanyByTickerComplete,
  getLatestMarketSnapshot,
  searchCompanies
} from "../repositories/companyRepository.js";
import {
  computeDataHealth,
  resolveCompanyFromQuery,
  suggestUsTickers,
  verifyUsTicker
} from "../services/companyResolver.js";

function requestUrl(req) {
  return new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
}

export async function handleCompanySearch(req, res) {
  try {
    const query = requestUrl(req).searchParams.get("q") || "";
    if (!query.trim()) return sendOk(res, { companies: [], total: 0 });
    const companies = searchCompanies(query);
    sendOk(res, { companies, total: companies.length });
  } catch (error) {
    sendError(res, 500, error.message || "搜索失败");
  }
}

export async function handleCompanyVerify(req, res) {
  try {
    const url = requestUrl(req);
    const ticker = (url.searchParams.get("ticker") || url.searchParams.get("q") || "").toUpperCase().trim();
    if (!/^[A-Z][A-Z.-]{0,6}$/.test(ticker)) return sendOk(res, { status: "not_found", suggestions: [] });
    const check = await verifyUsTicker(ticker);
    if (check.status !== "not_found") return sendOk(res, check);
    sendOk(res, { status: "not_found", suggestions: await suggestUsTickers(ticker) });
  } catch (error) {
    sendError(res, 500, error.message || "代码校验失败");
  }
}

export async function handleCompanyResolve(req, res) {
  try {
    const result = await resolveCompanyFromQuery((requestUrl(req).searchParams.get("q") || "").trim());
    sendOk(res, result.company
      ? { company: result.company }
      : { company: null, reason: result.reason, name: result.name });
  } catch (error) {
    sendError(res, 500, error.message || "公司解析失败");
  }
}

export async function handleCompanyByTicker(req, res, ticker) {
  try {
    if (!ticker) return sendError(res, 400, "缺少 ticker");
    const company = getCompanyByTickerComplete(ticker);
    if (!company) return sendError(res, 404, `未找到公司 ${ticker}`);
    const snapshot = getLatestMarketSnapshot(ticker);
    sendOk(res, {
      company,
      health: computeDataHealth(company),
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
    if (!ticker) return sendError(res, 400, "缺少 ticker");
    const company = getCompanyByTickerComplete(ticker);
    if (!company) return sendError(res, 404, `未找到公司 ${ticker}`);
    sendOk(res, { health: computeDataHealth(company) });
  } catch (error) {
    sendError(res, 500, error.message || "获取数据健康失败");
  }
}
