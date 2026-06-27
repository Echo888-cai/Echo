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
import { getFinancials, getAnalystEstimates, getCompanyProfile, getDividendHistory, getRevenueSegments } from "../../financialData.js";
import { getRecentFilings } from "../../filingData.js";
import { isUS } from "../../market.js";
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

  // Fetch company profile in parallel only for unknown tickers (nameZh === ticker),
  // so bare US tickers like RKLB get a real company name from FMP.
  const needsProfileLookup = !company.nameZh || company.nameZh === company.ticker;

  const tasks = await Promise.allSettled([
    suppliedMarketSnapshot
      ? Promise.resolve(suppliedMarketSnapshot)
      // 6s：getMarketSnapshot 现在第一梯队并发竞速（~1-2s 即可返回最快源），但研究时
      // 还并发着 news/财报/评级/分部 + 网页证据检索，给足余量避免被挤超时退化成"行情 missing"。
      : withTimeout(getMarketSnapshot(company.ticker), 6000, fallbackMarketSnapshot(company.ticker, "行情请求超时")),
    // 7s（不是 3.5s）：新闻管道现在以可靠源（Finnhub/Tavily，~1-2s 就够了就早返回）为主，
    // 但 Tavily 慢网可达 6s；3.5s 会在可靠源还没回来时就超时退化成"新闻✗"——这正是
    // "新闻一直不可用"的根因之一。给足预算让早返回机制真正生效。
    withTimeout(getNewsSnapshot(company), 7000, fallbackNewsSnapshot(company, "新闻请求超时")),
    withTimeout(getFinancials(company.ticker), 8000, { providerStatus: "missing", errors: ["财务数据请求超时"], asOf: new Date().toISOString() }),
    withTimeout(getRecentFilings(company.ticker), 5000, { providerStatus: "missing", errors: ["公告请求超时"], filings: [], asOf: new Date().toISOString() }),
    // 6s（不是 4s）：getAnalystEstimates 现在串行跑 FMP grades→Finnhub→Yahoo 目标价，
    // 4s 在慢网下会超时丢掉分析师锚（置信度也跟着掉一档）。
    withTimeout(getAnalystEstimates(company.ticker), 6000, { providerStatus: "missing", errors: ["评级请求超时"], asOf: new Date().toISOString() }),
    needsProfileLookup
      ? withTimeout(getCompanyProfile(company.ticker), 4000, null)
      : Promise.resolve(null),
    // Revenue segmentation (cloud / AI / product lines) — US only, best-effort.
    isUS(company.ticker)
      ? withTimeout(getRevenueSegments(company.ticker), 6000, { providerStatus: "missing" })
      : Promise.resolve({ providerStatus: "missing" })
  ]);

  const [market, news, financials, filings, estimates, profileResult, segmentsResult] = tasks;
  const marketSnapshot = market.status === "fulfilled" ? market.value : fallbackMarketSnapshot(company.ticker, market.reason?.message || "行情失败");
  // Cache successful snapshots
  if (marketSnapshot.providerStatus === "ok") {
    try { saveMarketSnapshot(marketSnapshot); } catch {}
  }
  // Attach segment revenue onto the financials object so it rides along everywhere
  // financialsData flows (prompt live-financials block, report, etc.).
  const financialsData = financials.status === "fulfilled" ? financials.value : { providerStatus: "missing", errors: [financials.reason?.message || "财务失败"] };
  const segments = segmentsResult?.status === "fulfilled" ? segmentsResult.value : null;
  if (financialsData?.providerStatus === "ok" && segments?.providerStatus === "ok") {
    financialsData.segments = segments;
  }
  return {
    marketSnapshot: market.status === "fulfilled" ? market.value : fallbackMarketSnapshot(company.ticker, market.reason?.message || "行情失败"),
    newsSnapshot: news.status === "fulfilled" ? news.value : fallbackNewsSnapshot(company, news.reason?.message || "新闻失败"),
    financialsData,
    filingsData: filings.status === "fulfilled" ? filings.value : { providerStatus: "missing", filings: [], errors: [filings.reason?.message || "公告失败"] },
    estimatesData: estimates.status === "fulfilled" ? estimates.value : { providerStatus: "missing", errors: [estimates.reason?.message || "评级失败"] },
    companyProfile: profileResult?.status === "fulfilled" ? profileResult.value : null,
    errors
  };
}
