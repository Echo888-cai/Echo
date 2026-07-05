/**
 * financialQuality — derives calculated quality metrics from raw financial data.
 *
 * Accepts the output of financialData.js (getFinancials, etc.) and produces
 * structured quality assessments with source transparency.
 *
 * Every returned metric includes:
 *   - value: the number or formatted string
 *   - status: "ok" | "stale" | "missing"
 *   - source: which provider gave the data
 *   - asOf: when the data was fetched
 *
 * Missing data is explicitly listed — never faked.
 */

import { fmtPercent, compactNumberServer } from "../utils/format.js";

/**
 * Compute financial quality scores and metrics from raw financial data.
 *
 * @param {import("../types.js").FinancialsData} financialsData - the output of getFinancials()
 * @param {{marketCap?: number, pe?: number}} [opts]
 * @returns {{ metrics: object[], quality: object, missing: string[], summary?: string }}
 */
export function computeFinancialQuality(financialsData, { marketCap, pe } = {}) {
  if (!financialsData || financialsData.providerStatus !== "ok") {
    return {
      metrics: [],
      quality: {
        revenueGrowth: null,
        grossMargin: null,
        operatingMargin: null,
        netMargin: null,
        freeCashFlow: null,
        debtToEquity: null,
        roe: null,
        qualityScore: null
      },
      missing: ["收入增速", "毛利率", "经营利润率", "净利率", "FCF", "负债率", "ROE"],
      summary: "财务数据未接入，无法评估财务质量。"
    };
  }

  const source = financialsData.source || "财务数据源";
  const asOf = financialsData.asOf || "";
  const missing = [];

  function makeMetric(name, value, status = "ok") {
    if (value === null || value === undefined) {
      missing.push(name);
      return { name, value: null, display: "缺失", status: "missing", source, asOf };
    }
    return { name, value, display: String(value), status, source, asOf };
  }

  const metrics = [
    makeMetric("收入增速", financialsData.revenueGrowth != null ? fmtPercent(financialsData.revenueGrowth) : null),
    makeMetric("毛利率", financialsData.grossMargin != null ? fmtPercent(financialsData.grossMargin) : null),
    makeMetric("经营利润率", financialsData.operatingMargin != null ? fmtPercent(financialsData.operatingMargin) : null),
    makeMetric("净利率", financialsData.netMargin != null ? fmtPercent(financialsData.netMargin) : null),
    makeMetric("自由现金流", financialsData.freeCashFlow != null ? compactNumberServer(financialsData.freeCashFlow) : null),
    makeMetric("资产负债率", financialsData.debtToEquity != null ? String(financialsData.debtToEquity) : null),
    makeMetric("ROE", financialsData.returnOnEquity != null ? fmtPercent(financialsData.returnOnEquity) : null),
    makeMetric("EPS", financialsData.eps != null ? String(financialsData.eps) : null),
    makeMetric("回购金额", financialsData.repurchaseOfStock != null ? compactNumberServer(financialsData.repurchaseOfStock) : null),
    makeMetric("分红", financialsData.dividendPaid != null ? compactNumberServer(financialsData.dividendPaid) : null)
  ];

  // Calculate quality score (0-100) from available metrics
  let scorePoints = 0;
  let scoreMax = 0;

  if (financialsData.revenueGrowth != null) {
    const g = financialsData.revenueGrowth;
    if (g > 15) scorePoints += 20;
    else if (g > 5) scorePoints += 12;
    else if (g > 0) scorePoints += 6;
    else if (g > -10) scorePoints += 2;
    scoreMax += 20;
  }
  if (financialsData.grossMargin != null) {
    if (financialsData.grossMargin > 60) scorePoints += 20;
    else if (financialsData.grossMargin > 40) scorePoints += 15;
    else if (financialsData.grossMargin > 20) scorePoints += 8;
    else scorePoints += 3;
    scoreMax += 20;
  }
  if (financialsData.operatingMargin != null) {
    if (financialsData.operatingMargin > 25) scorePoints += 20;
    else if (financialsData.operatingMargin > 15) scorePoints += 15;
    else if (financialsData.operatingMargin > 5) scorePoints += 8;
    else if (financialsData.operatingMargin > 0) scorePoints += 3;
    scoreMax += 20;
  }
  if (financialsData.freeCashFlow != null) {
    scorePoints += financialsData.freeCashFlow > 0 ? 15 : 3;
    scoreMax += 15;
  }
  if (financialsData.debtToEquity != null) {
    if (financialsData.debtToEquity < 50) scorePoints += 15;
    else if (financialsData.debtToEquity < 100) scorePoints += 10;
    else if (financialsData.debtToEquity < 200) scorePoints += 5;
    else scorePoints += 2;
    scoreMax += 15;
  }
  if (financialsData.returnOnEquity != null) {
    if (financialsData.returnOnEquity > 20) scorePoints += 10;
    else if (financialsData.returnOnEquity > 10) scorePoints += 6;
    else if (financialsData.returnOnEquity > 0) scorePoints += 3;
    scoreMax += 10;
  }

  const qualityScore = scoreMax > 0 ? Math.round((scorePoints / scoreMax) * 100) : null;

  return {
    metrics: metrics.filter(m => m.status !== "missing"),
    missing,
    quality: {
      revenueGrowth: financialsData.revenueGrowth,
      grossMargin: financialsData.grossMargin,
      operatingMargin: financialsData.operatingMargin,
      netMargin: financialsData.netMargin,
      freeCashFlow: financialsData.freeCashFlow,
      debtToEquity: financialsData.debtToEquity,
      roe: financialsData.returnOnEquity,
      qualityScore
    },
    summary: qualityScore !== null
      ? `财务质量评分 ${qualityScore}/100（基于 ${scoreMax} 分权重体系）。${missing.length} 项缺失。`
      : "财务数据缺失，无法计算质量评分。"
  };
}
