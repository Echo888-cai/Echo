/**
 * dataSources — orchestrates market / news / financials / filings / estimates
 * fetches with hard timeouts. Returns a uniform shape:
 *   { marketSnapshot, newsSnapshot, financialsData, filingsData, estimatesData, errors }
 *
 * All timeouts return "missing" snapshots so downstream services can render
 * the "暂不评分" path without extra branching.
 */

import { withTimeout } from "../utils/async.js";
import { getMarketSnapshot } from "../../marketData.js";
import { getNewsSnapshot } from "../../newsData.js";
import { getFinancials, getAnalystEstimates, getCompanyProfile, getDividendHistory } from "../../financialData.js";
import { getRecentFilings } from "../../filingData.js";
import { saveMarketSnapshot } from "../../db/index.js";

export function fallbackMarketSnapshot(ticker, reason = "timeout") {
  return {
    source: "未接入",
    ticker,
    currency: "HKD",
    price: null,
    previousClose: null,
    change: null,
    changePercent: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    marketCap: null,
    pe: null,
    dividendYield: null,
    week52High: null,
    week52Low: null,
    asOf: new Date().toISOString(),
    providerStatus: "missing",
    errors: [reason]
  };
}

export function fallbackNewsSnapshot(company, reason = "timeout") {
  return {
    source: "未接入",
    ticker: company.ticker,
    providerStatus: "missing",
    asOf: new Date().toISOString(),
    articles: [],
    sentiment: { label: "未知", score: 0, positiveCount: 0, negativeCount: 0, neutralCount: 0 },
    scopeSummary: {},
    coverageGaps: ["财经", "监管", "舆论", "社会", "行业"],
    errors: [reason]
  };
}

export async function collectDataSources({ company, suppliedMarketSnapshot = null }) {
  if (!company?.ticker) throw new Error("缺少公司上下文");
  const errors = [];

  const tasks = await Promise.allSettled([
    suppliedMarketSnapshot
      ? Promise.resolve(suppliedMarketSnapshot)
      : withTimeout(getMarketSnapshot(company.ticker), 3500, fallbackMarketSnapshot(company.ticker, "行情请求超时")),
    withTimeout(getNewsSnapshot(company), 3500, fallbackNewsSnapshot(company, "新闻请求超时")),
    withTimeout(getFinancials(company.ticker), 5000, { providerStatus: "missing", errors: ["财务数据请求超时"], asOf: new Date().toISOString() }),
    withTimeout(getRecentFilings(company.ticker), 5000, { providerStatus: "missing", errors: ["公告请求超时"], filings: [], asOf: new Date().toISOString() }),
    withTimeout(getAnalystEstimates(company.ticker), 4000, { providerStatus: "missing", errors: ["评级请求超时"], asOf: new Date().toISOString() })
  ]);

  const [market, news, financials, filings, estimates] = tasks;
  const marketSnapshot = market.status === "fulfilled" ? market.value : fallbackMarketSnapshot(company.ticker, market.reason?.message || "行情失败");
  // Cache successful snapshots
  if (marketSnapshot.providerStatus === "ok") {
    try { saveMarketSnapshot(marketSnapshot); } catch {}
  }
  return {
    marketSnapshot: market.status === "fulfilled" ? market.value : fallbackMarketSnapshot(company.ticker, market.reason?.message || "行情失败"),
    newsSnapshot: news.status === "fulfilled" ? news.value : fallbackNewsSnapshot(company, news.reason?.message || "新闻失败"),
    financialsData: financials.status === "fulfilled" ? financials.value : { providerStatus: "missing", errors: [financials.reason?.message || "财务失败"] },
    filingsData: filings.status === "fulfilled" ? filings.value : { providerStatus: "missing", filings: [], errors: [filings.reason?.message || "公告失败"] },
    estimatesData: estimates.status === "fulfilled" ? estimates.value : { providerStatus: "missing", errors: [estimates.reason?.message || "评级失败"] },
    errors
  };
}
