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

import { fmtPercent, compactNumberServer } from "./format.js";

/**
 * Compute financial quality scores and metrics from raw financial data.
 *
 * @param {Object} financialsData - normalized financial facts
 * @param {{marketCap?: number, pe?: number}} [_opts]
 * @returns {{ metrics: object[], quality: object, missing: string[], summary?: string }}
 */
export function computeFinancialQuality(financialsData, _opts = {}) {
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

/**
 * hkBuybackToPrompt — HKEX「翌日披露报表」里的真实场内购回记录 → 提示词事实块。
 *
 * 为什么需要它：hk_buybacks 由 hkFilingsPipeline 一直在采集（腾讯已有半年 29 次真实
 * 记录），但过去没有任何读取方——数据采了没人用，而 composer 同时还在对模型说
 * "回购分红口径还没核到，股东回报判断暂为低置信度"。回购是港股股东回报最硬的一手
 * 事实，让它继续缺席等于逼模型从印象里编。
 *
 * 两条口径纪律（沿用 #16 的原始实现，不能丢）：
 * - 只统计已真实成交的场内购回，不含尚未执行的授权额度——"计划回购 X 亿"不是事实。
 * - 已发行股份只给"逐次披露之间的粗线趋势"，不是即时净股本：HKEX 规则下购回股份在
 *   正式注销完成前仍计入已发行总数，注销有滞后。把这条近似说成精确股本变化就是错的。
 *
 * @param {Array} rows - listRecentHkBuybacks() 的结果（camelCase，新→旧排序）
 * @returns {string} 空数组返回 ""，由调用方决定"未接通"文案
 */
export function hkBuybackToPrompt(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const num = (value) => (value == null || value === "" ? null : Number(value));
  const totalShares = rows.reduce((sum, row) => sum + (num(row.sharesRepurchased) || 0), 0);
  const totalConsideration = rows.reduce((sum, row) => sum + (num(row.totalConsideration) || 0), 0);
  const currency = rows[0]?.currency || "HKD";
  const latest = rows[0];
  const oldest = rows[rows.length - 1];
  const issuedLatest = num(latest.sharesIssuedTotal);
  const issuedOldest = num(oldest.sharesIssuedTotal);

  const lines = [
    `港股回购（HKEX 翌日披露报表，近 ${rows.length} 次真实场内购回，${oldest.tradeDate}~${latest.tradeDate}）：`,
    `- 累计购回 ${totalShares.toLocaleString("en-US")} 股，总代价约 ${compactNumberServer(totalConsideration)} ${currency}`
  ];
  // 占已发行股份的比例——回购力度只有放在股本尺度上才有意义（绝对股数无法横向比较）。
  if (issuedLatest) {
    lines.push(`- 约占已发行股份 ${((totalShares / issuedLatest) * 100).toFixed(2)}%（期末已发行 ${issuedLatest.toLocaleString("en-US")} 股）`);
  }
  if (issuedLatest && issuedOldest && latest.periodEndDate && oldest.periodEndDate && latest.periodEndDate !== oldest.periodEndDate) {
    lines.push(`- 已发行股份粗线趋势（购回注销有滞后，非即时净股本）：${oldest.periodEndDate} ${issuedOldest.toLocaleString("en-US")} 股 → ${latest.periodEndDate} ${issuedLatest.toLocaleString("en-US")} 股`);
  }
  lines.push("- 口径：仅含已真实成交的场内购回，不含未执行的授权额度；不得据此推算未来回购规模。");
  return lines.join("\n");
}
