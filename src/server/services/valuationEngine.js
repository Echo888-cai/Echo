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
  // Stage-aware 数据存疑：EV/Sales 被可信度护栏判为脏（与市场定价/现价严重脱节，多半新上市数据缺口）→
  // 只允许回退到「可信的分析师目标价带」；没有就诚实地不给估值。绝不掉进下方"以现价为中心的 PE 带"——
  // 那对亏损股会拿负 PE 硬凑，又是"中性=现价"的自循环根因。
  if (v.stageAware && v.dataSuspect) {
    const band = buildAnalystBand(marketSnapshot, company, estimates);
    if (band) return analyst ? { ...band, analyst } : band;
    return analyst ? { ...v, analyst } : v;
  }
  // Stage-aware（EV/Sales 情景）刻意允许整条带在现价上方或下方（这正是"高估/低估"的诚实结论）：
  // 不套"必须 bear<price<bull"的 PE 带自洽检查，也绝不回退到以现价为中心的 PE 带（那是自循环根因）。
  if (v.stageAware && !v.cannotValueReason) return analyst ? { ...v, analyst } : v;
  const bear = parseFloat(v.bear);
  const bull = parseFloat(v.bull);
  const coherent =
    !v.cannotValueReason &&
    [bear, bull, price].every((n) => Number.isFinite(n)) &&
    bear > 0 &&
    bear < price &&
    price < bull;
  if (coherent) return analyst ? { ...v, analyst } : v;

  const band = buildAnalystBand(marketSnapshot, company, estimates);
  if (band) return analyst ? { ...band, analyst } : band;

  // Price-centered PE band from a quoted or EPS-derived PE — always coherent. This is
  // the guaranteed fallback so a bar renders whenever we have a price + real EPS, even
  // for growth names where FCF-yield is incoherent and analyst targets aren't trustworthy.
  const p = numOrNull(marketSnapshot?.price ?? company?.price);
  let pe = marketSnapshot?.pe ?? company?.pe;
  if (!pe && financialsData?.eps && p) pe = p / financialsData.eps;
  // pe 必须 > 0：亏损股的负 PE 不能拿来硬凑一条以现价为中心的带子（那是误导）。
  if (p && pe && pe > 0) {
    return {
      method: "PE 区间",
      bear: (p * 0.78).toFixed(2),
      base: p.toFixed(2),
      bull: (p * 1.28).toFixed(2),
      currentPrice: p,
      methods: ["PE 区间"],
      methodDetail: [{ name: "PE 区间", bear: p * 0.78, base: p, bull: p * 1.28 }],
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

/**
 * 可信的分析师目标价带（或 null）。中心必须落在现价 0.5x~1.8x 的合理区间，挡掉过期/未复权目标
 * （如 NVDA 共识 500 vs 现价 202 会渲染出误导的"中性 500 / +147%"）。displayValuation 的两条
 * 兜底路径（stage-aware 脏数据降级 / 传统带不自洽降级）共用，避免重复实现。
 */
function buildAnalystBand(marketSnapshot, company, estimates) {
  const p = numOrNull(marketSnapshot?.price ?? company?.price);
  const lo = numOrNull(estimates?.targetLow);
  const hi = numOrNull(estimates?.targetHigh);
  const mid = numOrNull(estimates?.consensusTargetPrice) ?? numOrNull(estimates?.targetMedian);
  const midRef = mid ?? (lo && hi ? (lo + hi) / 2 : null);
  const ok = p && lo && hi && lo < hi && midRef && midRef >= p * 0.5 && midRef <= p * 1.8;
  if (!ok) return null;
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
    methodDetail: [{ name: "分析师目标价", bear: bearV, base: baseV, bull: bullV }],
    keyAssumptions: [`基于分析师一致目标价：低 ${lo} / 中 ${mid ?? "—"} / 高 ${hi}（来源 ${estimates?.source || "评级源"}）`],
    sensitivity: [],
    cannotValueReason: null
  };
}

/** Distill analyst consensus into a compact anchor with upside-to-target. */
function analystAnchor(estimates, price) {
  if (!estimates || estimates.providerStatus !== "ok") return null;
  const target = numOrNull(estimates.consensusTargetPrice) ?? numOrNull(estimates.targetMedian);
  if (!target) return null;
  const upside = Number.isFinite(price) && price > 0 ? `${((target - price) / price * 100).toFixed(1)}%` : null;
  return { target, low: numOrNull(estimates.targetLow), high: numOrNull(estimates.targetHigh), upside, source: estimates.source || "评级源" };
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// 资产阶段分类（spec §三，先实现关键分支）：亏损股 EPS<0、PE 不适用，必须换估值口径，
// 否则会掉到 displayValuation 里"以现价为中心 ±25% PE 带"的自循环（中性=现价、赔率~1.3:1）。
//   loss_growth=亏损高成长、loss=亏损（低/无增长）、profitable=盈利（走传统 PE/FCF/DCF）。
function classifyAssetStage(f) {
  if (!f || f.providerStatus !== "ok") return "unknown";
  const eps = numOrNull(f.eps);
  const netMargin = numOrNull(f.netMargin);
  const opMargin = numOrNull(f.operatingMargin);
  const growth = numOrNull(f.revenueGrowth);
  // 净利润/EPS 是判断"亏损"的主信号；经营利润率单独告负、但净利润明确为正时大概率是一次性费用
  // /汇兑噪音，不该覆盖清晰为正的底线盈利——B-5 港股实测抓到：阿里 26Q1 经营利润率 -0.05%（一次性
  // 费用导致的噪音），净利率 +9.7%，旧逻辑三者任一为负就判亏损，会把这种巨头误判成"亏损高成长"，
  // 掉进 EV/Sales 情景算出远低于合理区间的估值带。经营利润率只在净利润/EPS 都缺失时才当亏损信号用。
  const netLoss = (eps !== null && eps < 0) || (netMargin !== null && netMargin < 0);
  const opLossOnly = eps === null && netMargin === null && opMargin !== null && opMargin < 0;
  const lossMaking = netLoss || opLossOnly;
  if (lossMaking) return growth !== null && growth >= 20 ? "loss_growth" : "loss";
  return "profitable";
}

// 亏损股的 EV/Sales 情景估值：Bear/Base/Bull 各设目标 EV/Sales 倍数 × 前瞻收入 → 隐含 EV
// → 加净现金（现金−负债）→ ÷ 稀释股本 → 价格区间。赔率由 bull/bear vs 现价推出（非自循环），
// 并反推"当前价隐含的 EV/Sales"（市场在押注什么）。倍数用按增速分档的行业规则默认值，每条情景
// 显式列假设。缺收入/股本返回 null（落回传统逻辑，多半给 cannotValue）。
function computeEvSalesValuation({ stage, price, marketCap, revenue, revenueGrowth, grossMargin, sharesOutstanding, cashAndEquivalents, totalDebt, netCash: explicitNetCash }) {
  const rev = numOrNull(revenue);
  const shares = numOrNull(sharesOutstanding);
  const p = numOrNull(price);
  if (!rev || rev <= 0 || !shares || shares <= 0 || !p || p <= 0) return null;
  // 同 DCF 的净现金口径修复：优先用来源已给出的净现金（如港股一手抽取只给"净现金"一个数，
  // 不拆分现金/负债两项），否则才用 现金-负债；`totalDebt` 缺失（非 0）时不当净现金为 0。
  const netCash = numOrNull(explicitNetCash) ?? ((numOrNull(cashAndEquivalents) || 0) - (numOrNull(totalDebt) || 0));
  const growthRaw = numOrNull(revenueGrowth);
  const growth = growthRaw === null ? 0 : clamp(growthRaw / 100, -0.5, 1.5);
  // 前瞻 1 年收入（高成长股用前瞻更贴市场口径）；增速缺失则退回 TTM。
  const fwdRevenue = rev * (1 + growth);
  // 规则默认 EV/Sales 倍数，按增速分档：成长越高，市场给的倍数越高。
  const t = growth >= 0.4 ? { bear: 5, base: 10, bull: 16 }
          : growth >= 0.2 ? { bear: 3, base: 6, bull: 10 }
          : { bear: 1, base: 2.5, bull: 4 };
  const priceAt = (mult) => (mult * fwdRevenue + netCash) / shares;
  const bear = priceAt(t.bear);
  const base = priceAt(t.base);
  const bull = priceAt(t.bull);
  if (![bear, base, bull].every((n) => Number.isFinite(n) && n > 0)) return null;
  // 反推当前价隐含的 EV/Sales（市场在押注的成长定价），对接 spec"当前价隐含了什么预期"。
  const ev = (numOrNull(marketCap) || p * shares) - netCash;
  const impliedFwd = fwdRevenue > 0 ? ev / fwdRevenue : null;
  const impliedTtm = ev / rev;

  // 可信度护栏：EV/Sales 带必须和「市场实际隐含倍数 / 现价」大致同量级，否则多半是脏数据
  // （新上市票财报缺口、代码撞同名 ETF、收入/股本单位错配等）→ 宁可不估，绝不渲染错数字。
  // SpaceX 复盘：市场按 ~93x 隐含 EV/Sales 定价，引擎却套 1–4x，吐出"该跌 94–98%"的脏带还挂"置信度高"。
  const impliedRef = impliedFwd ?? impliedTtm;
  const offByMagnitude = Number.isFinite(impliedRef) && (impliedRef > t.bull * 3 || impliedRef < t.bear / 3);
  const bandDisconnected = bull < p * 0.5 || bear > p * 2;
  const mc = numOrNull(marketCap);
  const sharesVsCap = mc !== null && mc > 0 && Math.abs(p * shares - mc) / mc > 0.5; // price×shares 与市值自相矛盾 → per-share 口径不可信
  if (offByMagnitude || bandDisconnected || sharesVsCap) {
    return {
      method: "EV/Sales 情景",
      stageAware: true,
      stage,
      dataSuspect: true,
      bear: null, base: null, bull: null,
      currentPrice: p,
      keyAssumptions: [],
      sensitivity: [],
      cannotValueReason: "财报数据与市场定价严重不符（疑似新上市/数据缺口），暂不给可信估值。"
    };
  }

  const gmTxt = numOrNull(grossMargin) !== null ? `，毛利率 ${Number(grossMargin).toFixed(0)}%` : "";
  const growthTxt = growthRaw === null ? "增速未知用 TTM 收入" : `收入增速 ${growthRaw.toFixed(0)}%`;
  const stageTxt = stage === "loss_growth" ? "亏损高成长" : "亏损";
  return {
    method: "EV/Sales 情景",
    stageAware: true,
    stage,
    bear: bear.toFixed(2),
    base: base.toFixed(2),
    bull: bull.toFixed(2),
    upside: ((base - p) / p * 100).toFixed(1) + "%",
    downside: ((bear - p) / p * 100).toFixed(1) + "%",
    currentPrice: p,
    methods: ["EV/Sales 情景"],
    methodDetail: [{ name: "EV/Sales", bear, base, bull }],
    keyAssumptions: [
      `阶段：${stageTxt}（利润为负、PE 不适用）→ 用 EV/Sales 情景，不套 PE 带`,
      `前瞻收入 ≈ ${compactNumberServer(rev)} ×（1+${(growth * 100).toFixed(0)}%，${growthTxt}）= ${compactNumberServer(fwdRevenue)}${gmTxt}`,
      `看空 ${t.bear}x EV/Sales → ${bear.toFixed(2)}；中性 ${t.base}x → ${base.toFixed(2)}；看多 ${t.bull}x → ${bull.toFixed(2)}（行业规则默认倍数）`,
      `净现金 ${compactNumberServer(netCash)}，稀释股本 ${compactNumberServer(shares)}`,
      impliedFwd !== null ? `当前价隐含 ≈ ${impliedFwd.toFixed(1)}x 前瞻 / ${impliedTtm.toFixed(1)}x TTM EV/Sales（市场在押注的成长定价）` : ""
    ].filter(Boolean),
    sensitivity: [
      `EV/Sales 每变化 1x，目标价变化约 ${(fwdRevenue / shares).toFixed(2)}`,
      `收入或毛利率不及指引，目标倍数与价位同步下修`
    ],
    cannotValueReason: null
  };
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

  // ── Stage-aware：亏损股（PE 不适用）走 EV/Sales 情景，避免下游 displayValuation 掉到
  //    "以现价为中心 ±25% PE 带"的自循环（gap log 根因 D 在美股的复发）。成熟盈利股不受影响。
  const stage = classifyAssetStage(financialsData);
  if ((stage === "loss_growth" || stage === "loss") && hasFinancialsData) {
    const ev = computeEvSalesValuation({
      stage,
      price,
      marketCap,
      revenue: hasFinancialsData.revenue,
      revenueGrowth: hasFinancialsData.revenueGrowth,
      grossMargin: hasFinancialsData.grossMargin ?? hasFinancialsData.grossMargins,
      sharesOutstanding: hasFinancialsData.sharesOutstanding,
      cashAndEquivalents: hasFinancialsData.cashAndEquivalents,
      totalDebt: hasFinancialsData.totalDebt,
      netCash: hasFinancialsData.netCash
    });
    if (ev) return ev;
  }

  const methods = [];
  const assumptions = [];
  const sensitivity = [];

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
    // B-5 修复：原判断用 `&&`，无负债公司 totalDebt===0（falsy）会导致净现金整段被当 0 处理，
    // 净现金再多也不计入 DCF——债务为 0 是完全合法的财务状态，不该被当"数据缺失"。
    // 港股一手抽取（B-5）常见净现金充裕但零负债的公司，这个 bug 之前会把它们的 DCF 压低。
    const netCash = numOrNull(hasFinancialsData.netCash) ??
      ((numOrNull(hasFinancialsData.cashAndEquivalents) || 0) - (numOrNull(hasFinancialsData.totalDebt) || 0));
    const equityValue = enterpriseValue + netCash;
    const sharesOut = hasFinancialsData.sharesOutstanding || (marketCap && hasPrice ? marketCap / hasPrice : null);
    if (sharesOut && sharesOut > 0) {
      const dcfValue = equityValue / sharesOut;
      methods.push({ name: "DCF", bear: dcfValue * 0.8, base: dcfValue || price, bull: dcfValue * 1.2, weight: 1 });
      assumptions.push(`DCF: WACC ${(wacc*100).toFixed(0)}%, 永续增长 ${(terminalGrowth*100).toFixed(0)}%, 净现金 ${compactNumberServer(netCash)}`);
      sensitivity.push(`WACC 每 +/-1% 影响 DCF 目标价约 15-20%`);
      sensitivity.push(`永续增长假设每 +/-0.5% 影响约 5-10%`);
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
    // A-P2.1：每种方法各自推出的 bear/base/bull，让"区间怎么来的"可追溯（前端"估值依据"展开）。
    methodDetail: methods.map((m) => ({ name: m.name, bear: m.bear, base: m.base, bull: m.bull })),
    cannotValueReason: null
  };
}
