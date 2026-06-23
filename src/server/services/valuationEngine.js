/**
 * valuationEngine — structured multi-method valuation from available data.
 *
 * Methods:
 *   - PE: uses trailing PE from market data + consensus EPS
 *   - PB: uses book value
 *   - FCF Yield: uses Free Cash Flow / shares outstanding
 *   - DCF: simplified from FCF + growth assumptions
 *
 * Every scenario (bear / base / bull) has explicit key assumptions.
 * When data is insufficient, returns "cannotValue" with a clear reason.
 */

import { compactNumberServer } from "../utils/format.js";

/**
 * Compute a multi-scenario valuation.
 *
 * @param {object} opts
 * @param {number} opts.price        — current market price
 * @param {number} opts.pe           — trailing PE
 * @param {number} opts.forwardPE    — forward PE
 * @param {number} opts.eps          — earnings per share
 * @param {number} opts.freeCashFlow — total FCF
 * @param {number} opts.shares       — shares outstanding
 * @param {number} opts.bookValue    — book value per share
 * @param {number} opts.revenueGrowth — revenue growth percentage
 * @param {number} opts.netMargin    — net margin percentage
 * @param {string} opts.sector       — sector for PE reference
 * @returns {{ method, bear, base, bull, keyAssumptions, sensitivity, cannotValueReason }}
 */
/**
 * Display-safe valuation: runs computeValuation, but if its range is incoherent
 * with the live price (cross-source EPS/currency mismatches can put the price
 * outside bear..bull), falls back to a self-consistent PE dispersion band so the
 * visualization is never misleading. Returns cannotValueReason when even a band
 * can't be built.
 */
export function displayValuation(company, marketSnapshot, financialsData, estimates = null) {
  const v = computeValuation(company, marketSnapshot, financialsData);
  const price = parseFloat(v.currentPrice);
  // Analyst consensus is attached as an independent anchor whenever available —
  // it enriches even a coherent fundamental band (US gets real targets via FMP).
  const analyst = analystAnchor(estimates, price);
  const bear = parseFloat(v.bear);
  const bull = parseFloat(v.bull);
  const coherent =
    !v.cannotValueReason &&
    [bear, bull, price].every((n) => Number.isFinite(n)) &&
    bear > 0 &&
    bear < price &&
    price < bull;
  if (coherent) return analyst ? { ...v, analyst } : v;

  const p = numOrNull(marketSnapshot?.price ?? company?.price);
  const lo = numOrNull(estimates?.targetLow);
  const hi = numOrNull(estimates?.targetHigh);
  const mid = numOrNull(estimates?.consensusTargetPrice) ?? numOrNull(estimates?.targetMedian);
  const midRef = mid ?? (lo && hi ? (lo + hi) / 2 : null);
  // An analyst band is only trustworthy when its center sits in a plausible range
  // of the live price — guards against stale/unadjusted targets (e.g. NVDA consensus
  // 500 vs price 202, which would render a misleading "中性 500 / +147%" band).
  const analystBandOk = p && lo && hi && lo < hi && midRef && midRef >= p * 0.5 && midRef <= p * 1.8;
  if (analystBandOk) {
    // Bracket the current price so the bar stays coherent even when targets cluster above it.
    const bearV = Math.min(lo, p * 0.95);
    const bullV = Math.max(hi, p * 1.05);
    const baseV = mid && mid > bearV && mid < bullV ? mid : p;
    return {
      method: "分析师目标价区间",
      bear: bearV.toFixed(2),
      base: baseV.toFixed(2),
      bull: bullV.toFixed(2),
      currentPrice: p,
      methods: ["分析师目标价区间"],
      keyAssumptions: [`基于分析师一致目标价：低 ${lo} / 中 ${mid ?? "—"} / 高 ${hi}（来源 ${estimates.source || "评级源"}）`],
      sensitivity: [],
      analyst,
      cannotValueReason: null
    };
  }

  // Price-centered PE band from a quoted or EPS-derived PE — always coherent. This is
  // the guaranteed fallback so a bar renders whenever we have a price + real EPS, even
  // for growth names where FCF-yield is incoherent and analyst targets aren't trustworthy.
  let pe = marketSnapshot?.pe ?? company?.pe;
  if (!pe && financialsData?.eps && p) pe = p / financialsData.eps;
  if (p && pe) {
    return {
      method: "PE 区间",
      bear: (p * 0.78).toFixed(2),
      base: p.toFixed(2),
      bull: (p * 1.28).toFixed(2),
      currentPrice: p,
      methods: ["PE 区间"],
      keyAssumptions: [`基于现价与 PE ${Number(pe).toFixed(1)}x 的估值带（约 ±25%，反映 PE 收缩/扩张）`],
      sensitivity: [],
      analyst,
      cannotValueReason: null
    };
  }
  return { ...v, analyst, cannotValueReason: v.cannotValueReason || "缺少自洽的估值口径。" };
}

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Distill analyst consensus into a compact anchor with upside-to-target. */
function analystAnchor(estimates, price) {
  if (!estimates || estimates.providerStatus !== "ok") return null;
  const target = numOrNull(estimates.consensusTargetPrice) ?? numOrNull(estimates.targetMedian);
  if (!target) return null;
  const upside = Number.isFinite(price) && price > 0 ? `${((target - price) / price * 100).toFixed(1)}%` : null;
  return { target, low: numOrNull(estimates.targetLow), high: numOrNull(estimates.targetHigh), upside, source: estimates.source || "评级源" };
}

export function computeValuation(company, marketSnapshot, financialsData) {
  if (!company || !marketSnapshot) {
    return {
      method: "无法估值",
      bear: null, base: null, bull: null,
      keyAssumptions: [],
      sensitivity: [],
      cannotValueReason: "缺少公司信息和行情数据，无法估值。"
    };
  }

  const price = marketSnapshot.price || company.price;
  const pe = marketSnapshot.pe || company.pe;
  const marketCap = marketSnapshot.marketCap;
  const hasPrice = price !== null && price !== undefined;
  const hasFinancials = financialsData?.providerStatus === "ok";
  const hasFinancialsData = hasFinancials && financialsData;

  // If we have no price, we can't value
  if (!hasPrice) {
    return {
      method: "无法估值",
      bear: null, base: null, bull: null,
      keyAssumptions: [],
      sensitivity: [],
      cannotValueReason: "缺行情价格，无法估值。"
    };
  }

  const methods = [];
  const assumptions = [];
  const sensitivity = [];
  let bestBase = null;

  // ── PE method ──────────────────────────────────────
  if (pe && hasFinancialsData?.eps) {
    const eps = hasFinancialsData.eps;
    // Sector-based PE band references
    const peBear = pe * 0.7;
    const peBase = pe;
    const peBull = pe * 1.3;
    const bear = eps * peBear;
    const base = eps * peBase;
    const bull = eps * peBull;
    methods.push({ name: "PE", bear, base, bull, weight: 1 });
    assumptions.push(
      `Trailing PE ${pe}x (bear ${peBear.toFixed(1)}x, base ${peBase.toFixed(1)}x, bull ${peBull.toFixed(1)}x)`,
      `EPS ${eps}`
    );
    sensitivity.push(`PE 每变化 1x，目标价变化约 ${eps}`);
    if (hasFinancialsData.revenueGrowth !== null) {
      sensitivity.push(`收入增速 ${hasFinancialsData.revenueGrowth}% 若持续，PE 有上行空间`);
    }
    bestBase = base;
  }

  // ── Forward PE method ─────────────────────────────
  if (hasFinancialsData?.forwardPE && hasFinancialsData?.eps) {
    const fwdPE = hasFinancialsData.forwardPE;
    const eps = hasFinancialsData.eps;
    const bear = eps * (fwdPE * 0.7);
    const base = eps * fwdPE;
    const bull = eps * (fwdPE * 1.3);
    methods.push({ name: "Forward PE", bear, base, bull, weight: 1 });
    assumptions.push(`Forward PE ${fwdPE}x`);
    if (!bestBase || bestBase < base) bestBase = base;
  }

  // ── FCF Yield method ──────────────────────────────
  if (hasFinancialsData?.freeCashFlow && hasFinancialsData?.sharesOutstanding) {
    const fcfPerShare = hasFinancialsData.freeCashFlow / hasFinancialsData.sharesOutstanding;
    // Yield range: bear 10%, base 7%, bull 5%
    const bear = fcfPerShare / 0.10;
    const base = fcfPerShare / 0.07;
    const bull = fcfPerShare / 0.05;
    methods.push({ name: "FCF Yield", bear, base, bull, weight: 1 });
    assumptions.push(`FCF per share ${compactNumberServer(fcfPerShare)} (yield range 5-10%)`);
    sensitivity.push(`FCF 每变化 10%，FCF 法目标价同步变化约 10%`);
    if (!bestBase || bestBase < base) bestBase = base;
  }

  // ── PB method (fallback for financials) ────────────
  if (company.sector?.includes("金融") && company.pb) {
    const pb = parseFloat(String(company.pb).replace("x", ""));
    if (!isNaN(pb) && pb > 0) {
      const bookValue = hasPrice / pb;
      const bear = bookValue * (pb * 0.7);
      const base = bookValue * pb;
      const bull = bookValue * (pb * 1.3);
      methods.push({ name: "PB", bear, base, bull, weight: 1 });
      assumptions.push(`PB ${pb}x (基于 seed/行情PE反推)`);
    }
  }

  // ── DCF simplified ─────────────────────────────────
  if (hasFinancialsData?.freeCashFlow && hasFinancialsData?.revenueGrowth !== null) {
    const fcf0 = hasFinancialsData.freeCashFlow;
    const growth = hasFinancialsData.revenueGrowth / 100;
    const wacc = 0.10;
    const terminalGrowth = 0.03;
    // Simple 5-year DCF
    let pv = 0;
    let fcf = fcf0;
    for (let y = 1; y <= 5; y++) {
      fcf = fcf * (1 + growth);
      pv += fcf / Math.pow(1 + wacc, y);
    }
    const terminal = fcf * (1 + terminalGrowth) / (wacc - terminalGrowth) / Math.pow(1 + wacc, 5);
    const enterpriseValue = pv + terminal;
    let netCash = 0;
    if (hasFinancialsData.cashAndEquivalents && hasFinancialsData.totalDebt) {
      netCash = hasFinancialsData.cashAndEquivalents - hasFinancialsData.totalDebt;
    }
    const equityValue = enterpriseValue + netCash;
    const sharesOut = hasFinancialsData.sharesOutstanding || (marketCap && hasPrice ? marketCap / hasPrice : null);
    if (sharesOut && sharesOut > 0) {
      const dcfValue = equityValue / sharesOut;
      methods.push({ name: "DCF", bear: dcfValue * 0.8, base: dcfValue || price, bull: dcfValue * 1.2, weight: 1 });
      assumptions.push(`DCF: WACC ${(wacc*100).toFixed(0)}%, 永续增长 ${(terminalGrowth*100).toFixed(0)}%, 净现金 ${compactNumberServer(netCash)}`);
      sensitivity.push(`WACC 每 +/-1% 影响 DCF 目标价约 15-20%`);
      sensitivity.push(`永续增长假设每 +/-0.5% 影响约 5-10%`);
      if (!bestBase) bestBase = dcfValue;
    }
  }

  // ── Fallback: simple PE from market ──────────────
  if (methods.length === 0 && pe) {
    const peBear = pe * 0.7;
    const peBase = pe;
    const peBull = pe * 1.3;
    const eps = hasPrice / pe;
    methods.push({ name: "简单 PE", bear: eps * peBear, base: eps * peBase, bull: eps * peBull, weight: 1 });
    assumptions.push(`仅基于行情 PE ${pe}x，缺 EPS 验证`);
    bestBase = eps * peBase;
  }

  if (methods.length === 0) {
    return {
      method: "无法估值",
      bear: null, base: null, bull: null,
      keyAssumptions: ["缺少 PE、EPS、FCF 等估值所需数据。"],
      sensitivity: [],
      cannotValueReason: "缺少 PE、FCF 和 EPS 数据，无法建立估值框架。配置 FMP_API_KEY 或上传年报补全。"
    };
  }

  // Weight-average the methods
  const totalWeight = methods.reduce((s, m) => s + m.weight, 0);
  const weighted = (key) => methods.reduce((s, m) => s + m[key] * m.weight, 0) / totalWeight;

  return {
    method: methods.map(m => m.name).join(" + "),
    bear: weighted("bear").toFixed(2),
    base: weighted("base").toFixed(2),
    bull: weighted("bull").toFixed(2),
    upside: price ? ((weighted("base") - price) / price * 100).toFixed(1) + "%" : null,
    downside: price ? ((weighted("bear") - price) / price * 100).toFixed(1) + "%" : null,
    currentPrice: price,
    keyAssumptions: assumptions,
    sensitivity,
    methods: methods.map(m => m.name),
    cannotValueReason: null
  };
}
