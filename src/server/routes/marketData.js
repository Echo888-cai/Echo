import { withTimeout, sendJson } from "../utils/async.js";
import { getMarketSnapshot } from "../../marketData.js";
import { getNewsSnapshot } from "../../newsData.js";
import { getFinancials, getCompanyProfile, getAnalystEstimates, getDividendHistory } from "../../financialData.js";
import { getRecentFilings } from "../../filingData.js";
import { companyByTicker } from "../../data.js";
import { getCompanyByTicker, saveMarketSnapshot } from "../../db/index.js";

function resolveCompany(ticker) {
  try {
    const fromDb = getCompanyByTicker(ticker);
    if (fromDb) return fromDb;
  } catch {}
  return companyByTicker(ticker) || { ticker: ticker?.toUpperCase() || "", nameZh: ticker };
}

export async function handleMarketApi(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const ticker = url.searchParams.get("ticker");
  if (!ticker) {
    sendJson(res, 400, { error: "缺少 ticker" });
    return;
  }
  const snapshot = await getMarketSnapshot(ticker);
  // Cache successful snapshots (best-effort)
  if (snapshot.providerStatus === "ok") {
    try { saveMarketSnapshot(snapshot); } catch {}
  }
  sendJson(res, 200, snapshot);
}

export async function handleNewsApi(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const ticker = url.searchParams.get("ticker");
  if (!ticker) {
    sendJson(res, 400, { error: "缺少 ticker" });
    return;
  }
  const company = resolveCompany(ticker);
  const snapshot = await getNewsSnapshot(company);
  sendJson(res, 200, snapshot);
}

export async function handleFinancialsApi(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const ticker = url.searchParams.get("ticker");
  if (!ticker) {
    sendJson(res, 400, { error: "缺少 ticker" });
    return;
  }
  const [financials, profile, estimates, dividends] = await Promise.allSettled([
    withTimeout(getFinancials(ticker), 6000, { providerStatus: "missing", errors: ["超时"] }),
    withTimeout(getCompanyProfile(ticker), 5000, { providerStatus: "missing", errors: ["超时"] }),
    withTimeout(getAnalystEstimates(ticker), 5000, { providerStatus: "missing", errors: ["超时"] }),
    withTimeout(getDividendHistory(ticker), 5000, { providerStatus: "missing", errors: ["超时"] })
  ]);
  sendJson(res, 200, {
    ticker,
    financials: financials.status === "fulfilled" ? financials.value : { providerStatus: "missing", errors: [financials.reason?.message || "获取失败"] },
    profile: profile.status === "fulfilled" ? profile.value : { providerStatus: "missing", errors: [profile.reason?.message || "获取失败"] },
    estimates: estimates.status === "fulfilled" ? estimates.value : { providerStatus: "missing", errors: [estimates.reason?.message || "获取失败"] },
    dividends: dividends.status === "fulfilled" ? dividends.value : { providerStatus: "missing", errors: [dividends.reason?.message || "获取失败"] }
  });
}

export async function handleFilingsApi(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  const ticker = url.searchParams.get("ticker");
  if (!ticker) {
    sendJson(res, 400, { error: "缺少 ticker" });
    return;
  }
  const filings = await withTimeout(getRecentFilings(ticker), 8000, { providerStatus: "missing", errors: ["超时"], filings: [] });
  sendJson(res, 200, filings);
}
