/**
 * dataSources — orchestrates market / news / financials / filings / estimates
 * fetches with hard timeouts. Returns a uniform shape:
 *   { marketSnapshot, newsSnapshot, financialsData, filingsData, estimatesData, errors }
 *
 * All timeouts return "missing" snapshots so downstream services can render
 * the "暂不评分" path without extra branching.
 */

import { withTimeout } from "../utils/async.js";
import { getMarketSnapshot, getRangeReturns } from "../../marketData.js";
import { getNewsSnapshot } from "../../newsData.js";
import { getFinancials, getAnalystEstimates, getCompanyProfile, getDividendHistory, getRevenueSegments } from "../../financialData.js";
import { getRecentFilings } from "../../filingData.js";
import { enrich8K } from "../../secFilings.js";
import { isUS } from "../../market.js";
import { saveMarketSnapshot } from "../../db/index.js";
import { getHkFinancials } from "../repositories/hkFinancialsRepository.js";
import { hkRowToFinancials, refreshHkFinancialsInBackground } from "./hkFilingsPipeline.js";

// B-5：展示级近似汇率（人民币列报 → 港元，估值口径用；非交易口径），与 portfolioReview.js
// 的 FX_TO_USD 同一处理原则——不接汇率 API，只求量级不失真。
const CNY_TO_HKD = 1.08;

// 港股一手抽取（HKEX PDF）里的"绝对金额"字段：第三方源（腾讯等）拿不到时用来补空。
// eps 不在其中——eps 要和第三方给的 pe 配对使用（PE = price / eps），若两者来自不同币种
// 混用会把 PE 法算错，宁可保持第三方 eps 缺失时的"无法估值"，也不要拼出一个假自洽的数字。
const HK_MONEY_FIELDS = [
  "revenue", "grossProfit", "operatingIncome", "netIncome",
  "cashAndEquivalents", "netCash", "operatingCashFlow"
];
const HK_RATIO_FIELDS = ["revenueGrowth", "grossMargin", "operatingMargin", "netMargin", "profitGrowth"];

/**
 * 把一手 HKEX 财报（hkRowToFinancials 的结果）里第三方源缺的字段补进 financialsData。
 * 之前只在第三方"全挂"（providerStatus !== "ok"）时才合并一手数据——但港股最常见的情况是
 * 腾讯免费接口成功（有价格/PE/市值）却只给基础行情，revenue/净利/现金流全是 null，
 * 一手抽取的真实数据因此被晾在 financialsData.hkFilings 里只当证据引用，从没进过估值引擎的
 * 数值字段。这正是"港股估值退化成机械 PE 带"的根因（B-5）。
 */
export function mergeHkFinancialGaps(target, hkFinancials) {
  const needsFx = hkFinancials.currency === "CNY" && target.currency !== "CNY";
  for (const key of HK_MONEY_FIELDS) {
    if (target[key] != null) continue;
    const v = hkFinancials[key];
    if (v == null) continue;
    target[key] = needsFx ? v * CNY_TO_HKD : v;
  }
  for (const key of HK_RATIO_FIELDS) {
    if (target[key] == null && hkFinancials[key] != null) target[key] = hkFinancials[key];
  }
  if (target.revenueTrend == null && hkFinancials.revenueTrend != null) target.revenueTrend = hkFinancials.revenueTrend;
  if (target.profitTrend == null && hkFinancials.profitTrend != null) target.profitTrend = hkFinancials.profitTrend;
  if (target.period == null || target.period === "") target.period = hkFinancials.period;
  target.firstPartySupplement = true;
}

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
    // 美股在公告列表后串上 8-K 原文 item 抽取（P7），整链 10s；港股仍是 5s 纯列表。
    withTimeout(
      getRecentFilings(company.ticker).then(async (fd) => {
        if (fd?.providerStatus === "ok" && isUS(company.ticker)) {
          try {
            const eightK = await enrich8K(fd);
            if (eightK.providerStatus === "ok") fd.eightK = eightK;
          } catch { /* 8-K 增强失败不影响公告列表 */ }
        }
        return fd;
      }),
      isUS(company.ticker) ? 10000 : 5000,
      { providerStatus: "missing", errors: ["公告请求超时"], filings: [], asOf: new Date().toISOString() }
    ),
    // 6s（不是 4s）：getAnalystEstimates 现在串行跑 FMP grades→Finnhub→Yahoo 目标价，
    // 4s 在慢网下会超时丢掉分析师锚（置信度也跟着掉一档）。
    withTimeout(getAnalystEstimates(company.ticker), 6000, { providerStatus: "missing", errors: ["评级请求超时"], asOf: new Date().toISOString() }),
    needsProfileLookup
      ? withTimeout(getCompanyProfile(company.ticker), 4000, null)
      : Promise.resolve(null),
    // Revenue segmentation (cloud / AI / product lines) — US only, best-effort.
    isUS(company.ticker)
      ? withTimeout(getRevenueSegments(company.ticker), 6000, { providerStatus: "missing" })
      : Promise.resolve({ providerStatus: "missing" }),
    // 区间回报（近1月/年初至今）——美股可得、港股免费档拿不到时返回 missing。
    withTimeout(getRangeReturns(company.ticker), 6500, { providerStatus: "missing" })
  ]);

  const [market, news, financials, filings, estimates, profileResult, segmentsResult, rangesResult] = tasks;
  const marketSnapshot = market.status === "fulfilled" ? market.value : fallbackMarketSnapshot(company.ticker, market.reason?.message || "行情失败");
  // 区间回报挂到行情快照上，随 marketSnapshot 一路流到 prompt / 前端 / 决策面板。
  const ranges = rangesResult?.status === "fulfilled" ? rangesResult.value : null;
  if (ranges?.providerStatus === "ok") marketSnapshot.ranges = ranges;
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
  // P7 港股一手财报：hk_financials 已落库则同步附挂（零延迟）；第三方全挂时提升为主数据，
  // 第三方部分成功（腾讯只给行情）时按字段补空（B-5，见 mergeHkFinancialGaps）。
  // 无数据或最新一期已过一个业绩季（>135 天）→ 后台摄取，不阻塞本次研究。
  if (!isUS(company.ticker)) {
    try {
      const hkRows = getHkFinancials(company.ticker, 4);
      if (hkRows.length) {
        financialsData.hkFilings = hkRows;
        const hkFinancials = hkRowToFinancials(hkRows[0]);
        if (financialsData.providerStatus !== "ok") {
          Object.assign(financialsData, hkFinancials);
        } else {
          mergeHkFinancialGaps(financialsData, hkFinancials);
        }
        const latest = Date.parse(hkRows[0].published_at || "") || 0;
        if (Date.now() - latest > 135 * 24 * 3600 * 1000) refreshHkFinancialsInBackground(company.ticker);
      } else {
        refreshHkFinancialsInBackground(company.ticker);
      }
    } catch { /* 一手财报读取失败不阻塞研究 */ }
  }
  return {
    marketSnapshot, // 已含 ranges（区间回报）
    newsSnapshot: news.status === "fulfilled" ? news.value : fallbackNewsSnapshot(company, news.reason?.message || "新闻失败"),
    financialsData,
    filingsData: filings.status === "fulfilled" ? filings.value : { providerStatus: "missing", filings: [], errors: [filings.reason?.message || "公告失败"] },
    estimatesData: estimates.status === "fulfilled" ? estimates.value : { providerStatus: "missing", errors: [estimates.reason?.message || "评级失败"] },
    companyProfile: profileResult?.status === "fulfilled" ? profileResult.value : null,
    errors
  };
}
