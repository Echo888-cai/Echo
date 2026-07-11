import { normalizeTicker } from "./data.js";
import { fmpSymbol, finnhubSymbol, tencentSymbol, detectMarket, marketCurrency, marketLabel } from "./market.js";
import { fmpGet, FMP_TTL } from "./fmpClient.js";

function env(name) {
  return process.env[name] || "";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compactNumber(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  if (Math.abs(number) >= 1e12) return `${(number / 1e12).toFixed(2)} 万亿`;
  if (Math.abs(number) >= 1e8) return `${(number / 1e8).toFixed(2)} 亿`;
  if (Math.abs(number) >= 1e4) return `${(number / 1e4).toFixed(2)} 万`;
  return `${number.toFixed(2)}`;
}

/**
 * B-2 财报理解：把"只看最新一期同比"升级成"多期增速的连续趋势"。专业分析师读财报会说
 * "增速连续两年放缓"，不会只报一个孤立的百分比。
 *
 * @param {number[]} growthRatesAsc 按时间升序排列的同比增速（%），最早的一段在前。
 * @returns {{direction:string, label:string, series:number[]}|null} 数据点 <2 个时无法判断趋势，返回 null。
 */
export function classifyTrend(growthRatesAsc) {
  const valid = (growthRatesAsc || []).filter((g) => g !== null && g !== undefined && Number.isFinite(g));
  if (valid.length < 2) return null;

  const last = valid[valid.length - 1];
  const prior = valid[valid.length - 2];
  const deltas = [];
  for (let i = 1; i < valid.length; i++) deltas.push(valid[i] - valid[i - 1]);
  const seriesText = valid.map((v) => `${v.toFixed(1)}%`).join(" → ");

  if (last < 0 && prior >= 0) {
    return { direction: "inflection_down", label: `增速由正转负（${seriesText}），出现下行拐点`, series: valid };
  }
  if (last >= 0 && prior < 0) {
    return { direction: "inflection_up", label: `增速由负转正（${seriesText}），出现修复拐点`, series: valid };
  }
  if (deltas.every((d) => d < -0.5)) {
    return { direction: "decelerating", label: `增速连续 ${deltas.length} 期放缓（${seriesText}）`, series: valid };
  }
  if (deltas.every((d) => d > 0.5)) {
    return { direction: "accelerating", label: `增速连续 ${deltas.length} 期加速（${seriesText}）`, series: valid };
  }
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  if (Math.abs(last - avg) < 2) {
    return { direction: "flat", label: `增速在 ${avg.toFixed(1)}% 附近波动，未见明显加速或放缓（${seriesText}）`, series: valid };
  }
  return { direction: "mixed", label: `增速波动、无单一方向（${seriesText}）`, series: valid };
}

/**
 * Finnhub `/stock/metric?metric=all` 的免费档其实带了 `series.annual.*`——每股口径的
 * 多年历史（salesPerShare/eps 等，实测 AAPL 有近 40 年数据）。FMP 的 income-statement
 * 端点被 402 挡住时，这是唯一能在免费档上做"多期趋势"的数据源，用每股口径代理绝对值
 * （分母是股本，YoY 场景下股本变动通常远小于业务本身的增速，够用）。
 * @param {Array<{period:string, v:number}>} seriesArr 与 Finnhub 一致：index 0 = 最新一期。
 */
export function trendFromAnnualSeries(seriesArr) {
  if (!Array.isArray(seriesArr) || seriesArr.length < 3) return null;
  const recentAscending = seriesArr.slice(0, 6).map((p) => numberOrNull(p?.v)).reverse();
  const growthSeries = [];
  for (let i = 1; i < recentAscending.length; i++) {
    const prior = recentAscending[i - 1];
    const cur = recentAscending[i];
    if (prior !== null && cur !== null && prior !== 0) growthSeries.push(((cur - prior) / Math.abs(prior)) * 100);
  }
  return classifyTrend(growthSeries);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "EchoResearch/1.0 financial data adapter",
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Financial Modeling Prep ──────────────────────────────────────────

function toFmpSymbol(ticker) {
  return fmpSymbol(ticker);
}

async function fetchFmpFinancials(ticker) {
  const symbol = toFmpSymbol(ticker);
  // B-2：limit 从 2 提到 6——只拿 2 期只够算"这期同比"，够不成"连续趋势"。6 期年报能算出
  // 5 段同比增速，分类出"连续放缓/加速/拐点"，这是专业分析师读财报的方式，不是单期快照。
  const [incomeStmt, balanceSheet, cashFlow] = await Promise.all([
    fmpGet("/stable/income-statement", { symbol, limit: 6 }, { ttl: FMP_TTL.financials, timeoutMs: 10000 }),
    fmpGet("/stable/balance-sheet-statement", { symbol, limit: 2 }, { ttl: FMP_TTL.financials, timeoutMs: 10000 }),
    fmpGet("/stable/cash-flow-statement", { symbol, limit: 2 }, { ttl: FMP_TTL.financials, timeoutMs: 10000 })
  ]);

  if (!incomeStmt?.length) throw new Error("FMP 没有返回利润表数据");

  const latest = incomeStmt[0];
  const previous = incomeStmt[1] || {};
  const latestBs = balanceSheet?.[0] || {};
  const latestCf = cashFlow?.[0] || {};

  const revenueGrowth = previous.revenue ? ((latest.revenue - previous.revenue) / Math.abs(previous.revenue)) * 100 : null;
  const profitGrowth = previous.netIncome && previous.netIncome !== 0 ? ((latest.netIncome - previous.netIncome) / Math.abs(previous.netIncome)) * 100 : null;

  // 按时间升序（最早的一段同比 → 最新一段）算逐期增速，喂给 classifyTrend 判断方向。
  const revenueGrowthSeries = [];
  const profitGrowthSeries = [];
  for (let i = incomeStmt.length - 2; i >= 0; i--) {
    const cur = incomeStmt[i];
    const prior = incomeStmt[i + 1];
    if (prior?.revenue) revenueGrowthSeries.push(((cur.revenue - prior.revenue) / Math.abs(prior.revenue)) * 100);
    if (prior?.netIncome) profitGrowthSeries.push(((cur.netIncome - prior.netIncome) / Math.abs(prior.netIncome)) * 100);
  }
  const revenueTrend = classifyTrend(revenueGrowthSeries);
  const profitTrend = classifyTrend(profitGrowthSeries);

  return {
    source: "FMP",
    ticker: normalizeTicker(ticker),
    period: latest.date || "",
    currency: latest.reportedCurrency || "HKD",
    revenue: numberOrNull(latest.revenue),
    revenueGrowth: numberOrNull(revenueGrowth),
    revenueTrend,
    grossProfit: numberOrNull(latest.grossProfit),
    grossMargin: latest.revenue ? numberOrNull((latest.grossProfit / latest.revenue) * 100) : null,
    operatingIncome: numberOrNull(latest.operatingIncome),
    operatingMargin: latest.revenue ? numberOrNull((latest.operatingIncome / latest.revenue) * 100) : null,
    netIncome: numberOrNull(latest.netIncome),
    netMargin: latest.revenue ? numberOrNull((latest.netIncome / latest.revenue) * 100) : null,
    profitGrowth: numberOrNull(profitGrowth),
    profitTrend,
    eps: numberOrNull(latest.eps),
    sharesOutstanding: numberOrNull(latest.weightedAverageShsOutDil ?? latest.weightedAverageShsOut),
    totalAssets: numberOrNull(latestBs.totalAssets),
    totalLiabilities: numberOrNull(latestBs.totalLiabilities),
    totalDebt: numberOrNull(latestBs.totalDebt),
    netDebt: numberOrNull(latestBs.netDebt),
    cashAndEquivalents: numberOrNull(latestBs.cashAndCashEquivalents),
    shareholdersEquity: numberOrNull(latestBs.totalStockholdersEquity),
    operatingCashFlow: numberOrNull(latestCf.operatingCashFlow),
    freeCashFlow: numberOrNull(latestCf.freeCashFlow),
    capitalExpenditure: numberOrNull(latestCf.capitalExpenditure),
    dividendPaid: numberOrNull(latestCf.netDividendsPaid ?? latestCf.commonDividendsPaid ?? latestCf.dividendsPaid),
    repurchaseOfStock: numberOrNull(latestCf.netStockRepurchased ?? latestCf.commonStockRepurchased ?? latestCf.repurchaseOfStock),
    asOf: new Date().toISOString(),
    providerStatus: "ok"
  };
}

async function fetchFmpCompanyProfile(ticker) {
  const symbol = toFmpSymbol(ticker);
  const profile = await fmpGet("/stable/profile", { symbol }, { ttl: FMP_TTL.profile, timeoutMs: 5000 });
  if (!profile?.length) throw new Error("FMP 没有返回公司画像");

  const data = profile[0];
  return {
    source: "FMP",
    ticker: normalizeTicker(ticker),
    companyName: data.companyName || "",
    description: data.description || "",
    industry: data.industry || "",
    sector: data.sector || "",
    employees: numberOrNull(data.fullTimeEmployees),
    ceo: data.ceo || "",
    website: data.website || "",
    exchange: data.exchange || "",
    marketCap: numberOrNull(data.mktCap),
    price: numberOrNull(data.price),
    pe: numberOrNull(data.pe),
    forwardPE: numberOrNull(data.forwardPE),
    eps: numberOrNull(data.eps),
    dividend: numberOrNull(data.lastDiv),
    dividendYield: numberOrNull(data.lastDiv && data.price ? (data.lastDiv / data.price) * 100 : null),
    beta: numberOrNull(data.beta),
    week52High: numberOrNull(data.yearHigh),
    week52Low: numberOrNull(data.yearLow),
    avgVolume: numberOrNull(data.volAvg),
    asOf: new Date().toISOString(),
    providerStatus: "ok"
  };
}

async function fetchFmpAnalystEstimates(ticker) {
  const symbol = toFmpSymbol(ticker);
  const [ratings, priceTarget] = await Promise.all([
    fmpGet("/stable/grades", { symbol, limit: 5 }, { ttl: FMP_TTL.estimates, timeoutMs: 5000 }),
    fmpGet("/stable/price-target-consensus", { symbol }, { ttl: FMP_TTL.estimates, timeoutMs: 5000 })
  ]);

  const recentRatings = (ratings || []).slice(0, 5).map((r) => ({
    date: r.date || "",
    firm: r.gradingCompany || "",
    grade: r.newGrade || "",
    action: r.newGradeAction || ""
  }));

  const consensus = priceTarget?.[0] || {};
  const targetPrice = numberOrNull(consensus.targetPrice || consensus.targetHigh || null);

  return {
    source: "FMP",
    ticker: normalizeTicker(ticker),
    consensusTargetPrice: targetPrice,
    targetHigh: numberOrNull(consensus.targetHigh),
    targetLow: numberOrNull(consensus.targetLow),
    targetMedian: numberOrNull(consensus.targetMedian),
    ratings: recentRatings,
    asOf: new Date().toISOString(),
    providerStatus: "ok"
  };
}

async function fetchFmpDividendHistory(ticker) {
  const symbol = toFmpSymbol(ticker);
  const dividends = await fmpGet("/stable/dividends", { symbol, limit: 8 }, { ttl: FMP_TTL.dividends, timeoutMs: 5000 });
  const historical = (Array.isArray(dividends) ? dividends : dividends?.historical || []).slice(0, 8).map((d) => ({
    date: d.date || "",
    dividend: numberOrNull(d.dividend),
    adjDividend: numberOrNull(d.adjDividend)
  }));

  return {
    source: "FMP",
    ticker: normalizeTicker(ticker),
    dividends: historical,
    trailingYield: historical.length ? historical[0].dividend : null,
    asOf: new Date().toISOString(),
    providerStatus: "ok"
  };
}

// ─── FMP 分部收入（产品/业务线，对标 HoneClaw 的分部数据） ────────────

/**
 * Normalize FMP revenue-segmentation into { period, total, segments[] } (pure).
 * Tolerates both the newer flat shape ({ data: { seg: val } }) and the older
 * nested shape ([{ "2024-09-28": { seg: val } }]).
 */
export function normalizeSegments(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) return null;
  const latest = list[0];
  let period = "";
  let data = null;
  if (latest && typeof latest.data === "object" && latest.data) {
    data = latest.data;
    period = latest.date || (latest.fiscalYear ? `${latest.fiscalYear} ${latest.period || ""}`.trim() : "");
  } else if (latest && typeof latest === "object") {
    const key = Object.keys(latest).find((k) => latest[k] && typeof latest[k] === "object");
    if (key) { data = latest[key]; period = key; }
  }
  if (!data) return null;
  const entries = Object.entries(data)
    .map(([name, value]) => ({ name, value: Number(value) }))
    .filter((s) => Number.isFinite(s.value) && s.value !== 0);
  if (!entries.length) return null;
  const total = entries.reduce((sum, s) => sum + Math.abs(s.value), 0);
  entries.sort((a, b) => b.value - a.value);
  return {
    period,
    total,
    segments: entries.slice(0, 8).map((s) => ({
      name: s.name,
      value: s.value,
      pct: total ? Math.round((s.value / total) * 100) : null
    }))
  };
}

async function fetchFmpSegments(ticker) {
  const symbol = toFmpSymbol(ticker);
  const raw = await fmpGet(
    "/stable/revenue-product-segmentation",
    { symbol, period: "annual", structure: "flat" },
    { ttl: FMP_TTL.financials, timeoutMs: 8000 }
  );
  const norm = normalizeSegments(raw);
  if (!norm) throw new Error("FMP 没有返回分部收入");
  return { source: "FMP", ticker: normalizeTicker(ticker), ...norm, providerStatus: "ok", asOf: new Date().toISOString() };
}

export async function getRevenueSegments(ticker) {
  return tryProviders([() => fetchFmpSegments(ticker)]);
}

// ─── Finnhub (扩展已有 key) ──────────────────────────────────────────

// Finnhub 基本面。关键点：/stock/metric 在免费档可用（含 PE/EPS/利润率/ROE/增长等
// 比率），是这里的主数据源；/stock/financials（绝对额三表）是付费端点，取得到就补充、
// 取不到也不影响——之前把两者放进同一个 Promise.all，付费端点 403 直接把整段拖垮，
// 白白丢掉了免费就能拿到的 EPS/PE/利润率（这正是"美股没有估值条、置信度低"的根因）。
async function fetchFinnhubFinancials(ticker) {
  const apiKey = env("FINNHUB_API_KEY");
  if (!apiKey) throw new Error("missing FINNHUB_API_KEY");
  const symbol = finnhubSymbol(ticker);

  const metrics = await fetchJson(
    `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey}`,
    { timeoutMs: 6000 }
  );
  const m = metrics?.metric || {};
  if (!Object.keys(m).length) throw new Error("Finnhub 没有返回基础财务指标");

  // B-2：免费档 series.annual 拿多期每股口径算趋势（见 trendFromAnnualSeries 注释）。
  const revenueTrend = trendFromAnnualSeries(metrics?.series?.annual?.salesPerShare);
  const profitTrend = trendFromAnnualSeries(metrics?.series?.annual?.eps);

  // 付费端点：能拿到绝对额（营收/净利）就补充，拿不到就只用 metric 的比率。
  let annual = null;
  try {
    const fin = await fetchJson(
      `https://finnhub.io/api/v1/stock/financials?symbol=${encodeURIComponent(symbol)}&statement=ic&freq=annually&token=${apiKey}`,
      { timeoutMs: 6000 }
    );
    annual = fin?.financials?.[0] || null;
  } catch { /* 付费端点不可用：跳过绝对额 */ }

  // 免费档兜底（B-P0 硬依赖）：profile2 给股本/市值。亏损股的 EV/Sales 情景需要 收入 + 股本 +
  // 现金，付费的 /stock/financials 常被 gate 掉，这里用 profile2 + metric 的 per-share/PS 反推。
  let shares = null;
  let mktCap = null;
  try {
    const prof = await fetchJson(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
      { timeoutMs: 5000 }
    );
    shares = prof?.shareOutstanding ? prof.shareOutstanding * 1e6 : null;        // Finnhub 单位：百万股
    mktCap = prof?.marketCapitalization ? prof.marketCapitalization * 1e6 : null; // 单位：百万
  } catch { /* profile2 不可用：跳过 */ }

  const pick = (...vals) => {
    for (const v of vals) {
      const n = numberOrNull(v);
      if (n !== null) return n;
    }
    return null;
  };

  // 收入/现金/负债：付费端点能给绝对额就用；否则用 metric 的 per-share/PS × 股本反推（免费档）。
  // 缺收入或股本会让亏损股掉回"以现价为中心"的 PE 带自循环（gap log 根因 D），故必须补齐。
  const revPerShare = pick(m.revenuePerShareTTM, m.revenuePerShareAnnual);
  const psRatio = pick(m.psTTM, m.psAnnual);
  const revenue = pick(
    annual?.revenue,
    revPerShare && shares ? revPerShare * shares : null,
    mktCap && psRatio ? mktCap / psRatio : null
  );
  const cashPerShare = pick(m.cashPerSharePerShareQuarterly, m.cashPerShareQuarterly, m.cashPerShareAnnual);
  const cashAndEquivalents = pick(annual?.cashAndEquivalents, cashPerShare && shares ? cashPerShare * shares : null);
  const bvps = pick(m.bookValuePerShareQuarterly, m.bookValuePerShareAnnual);
  const de = pick(m["totalDebt/totalEquityQuarterly"], m["totalDebt/totalEquityAnnual"]);
  const totalDebt = pick(annual?.totalDebt, bvps && shares && de !== null ? bvps * shares * de : null);

  return {
    source: "Finnhub",
    ticker: normalizeTicker(ticker),
    period: annual?.period || "TTM",
    currency: detectMarket(ticker) === "US" ? "USD" : "HKD",
    revenue,
    revenueGrowth: pick(m.revenueGrowthTTMYoy, m.revenueGrowthQuarterlyYoy, m.revenueGrowth5Y),
    revenueTrend,
    grossProfit: pick(annual?.grossIncome),
    grossMargin: pick(m.grossMarginTTM, m.grossMarginAnnual, m.grossMargin5Y),
    operatingIncome: pick(annual?.operatingIncome),
    operatingMargin: pick(m.operatingMarginTTM, m.operatingMarginAnnual, m.operatingMargin5Y),
    netIncome: pick(annual?.netIncome),
    netMargin: pick(m.netProfitMarginTTM, m.netProfitMarginAnnual, m.netProfitMargin5Y),
    profitGrowth: pick(m.epsGrowthTTMYoy, m.epsGrowth5Y, m.netMarginGrowth5Y),
    profitTrend,
    eps: pick(m.epsTTM, m.epsInclExtraItemsTTM, m.epsAnnual),
    sharesOutstanding: shares,
    marketCap: mktCap,
    cashAndEquivalents,
    totalDebt,
    pe: pick(m.peTTM, m.peInclExtraTTM, m.peNormalizedAnnual, m.peBasicExclExtraTTM),
    forwardPE: pick(m.forwardPE),
    ps: pick(m.psTTM, m.psAnnual),
    pb: pick(m.pbQuarterly, m.pbAnnual, m.pb),
    bookValuePerShare: pick(m.bookValuePerShareQuarterly, m.bookValuePerShareAnnual),
    cashFlowPerShare: pick(m.cashFlowPerShareTTM, m.cashFlowPerShareAnnual),
    dividendYield: pick(m.currentDividendYieldTTM, m.dividendYieldIndicatedAnnual),
    currentRatio: pick(m.currentRatioQuarterly, m.currentRatioAnnual),
    debtToEquity: pick(m["totalDebt/totalEquityQuarterly"], m["totalDebt/totalEquityAnnual"], m["longTermDebt/equityQuarterly"]),
    returnOnEquity: pick(m.roeTTM, m.roeRfy, m.roe5Y),
    returnOnAssets: pick(m.roaTTM, m.roaRfy, m.roa5Y),
    beta: pick(m.beta),
    week52High: pick(m["52WeekHigh"]),
    week52Low: pick(m["52WeekLow"]),
    asOf: new Date().toISOString(),
    providerStatus: "ok"
  };
}

async function fetchFinnhubRecommendation(ticker) {
  const apiKey = env("FINNHUB_API_KEY");
  if (!apiKey) throw new Error("missing FINNHUB_API_KEY");
  const symbol = finnhubSymbol(ticker);

  const data = await fetchJson(`https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`, { timeoutMs: 5000 });
  if (!data?.length) throw new Error("Finnhub 没有返回分析师推荐");

  const latest = data[0];
  return {
    source: "Finnhub",
    ticker: normalizeTicker(ticker),
    buy: latest.buy || 0,
    hold: latest.hold || 0,
    sell: latest.sell || 0,
    strongBuy: latest.strongBuy || 0,
    strongSell: latest.strongSell || 0,
    period: latest.period || "",
    consensus: latest.strongBuy + latest.buy > latest.sell + latest.strongSell ? "偏多" : latest.sell + latest.strongSell > latest.strongBuy + latest.buy ? "偏空" : "中性",
    asOf: new Date().toISOString(),
    providerStatus: "ok"
  };
}

// ─── Yahoo Finance (扩展端点) ────────────────────────────────────────

async function fetchYahooStatistics(ticker) {
  const symbol = normalizeTicker(ticker);
  const data = await fetchJson(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics,financialData,earningsTrend`, { timeoutMs: 6000 });

  const stats = data.quoteSummary?.result?.[0]?.defaultKeyStatistics || {};
  const financial = data.quoteSummary?.result?.[0]?.financialData || {};
  const earnings = data.quoteSummary?.result?.[0]?.earningsTrend || {};

  if (!Object.keys(stats).length && !Object.keys(financial).length) throw new Error("Yahoo 没有返回统计数据");

  const trend = earnings.trend || [];
  const currentEstimate = trend.find((t) => t.period === "0q") || {};

  return {
    source: "Yahoo Finance",
    ticker: normalizeTicker(ticker),
    enterpriseValue: numberOrNull(stats.enterpriseValue?.raw),
    forwardPE: numberOrNull(stats.forwardPE?.raw),
    pegRatio: numberOrNull(stats.pegRatio?.raw),
    enterpriseToRevenue: numberOrNull(stats.enterpriseToRevenue?.raw),
    enterpriseToEbitda: numberOrNull(stats.enterpriseToEbitda?.raw),
    beta: numberOrNull(stats.beta3Year?.raw || stats.beta?.raw),
    trailingPE: numberOrNull(stats.trailingPE?.raw),
    totalDebt: numberOrNull(financial.totalDebt?.raw),
    totalCash: numberOrNull(financial.totalCash?.raw),
    totalRevenue: numberOrNull(financial.totalRevenue?.raw),
    grossProfits: numberOrNull(financial.grossProfits?.raw),
    freeCashflow: numberOrNull(financial.freeCashflow?.raw),
    operatingCashflow: numberOrNull(financial.operatingCashflow?.raw),
    revenueGrowth: numberOrNull(financial.revenueGrowth?.raw ? financial.revenueGrowth.raw * 100 : null),
    earningsGrowth: numberOrNull(financial.earningsGrowth?.raw ? financial.earningsGrowth.raw * 100 : null),
    grossMargins: numberOrNull(financial.grossMargins?.raw ? financial.grossMargins.raw * 100 : null),
    operatingMargins: numberOrNull(financial.operatingMargins?.raw ? financial.operatingMargins.raw * 100 : null),
    profitMargins: numberOrNull(financial.profitMargins?.raw ? financial.profitMargins.raw * 100 : null),
    returnOnEquity: numberOrNull(financial.returnOnEquity?.raw ? financial.returnOnEquity.raw * 100 : null),
    returnOnAssets: numberOrNull(financial.returnOnAssets?.raw ? financial.returnOnAssets.raw * 100 : null),
    currentRatio: numberOrNull(financial.currentRatio?.raw),
    debtToEquity: numberOrNull(financial.debtToEquity?.raw),
    epsCurrentYear: numberOrNull(currentEstimate?.epsTrend?.current || stats.forwardEps?.raw),
    epsNextYear: numberOrNull(trend.find((t) => t.period === "+1q")?.epsTrend?.current || null),
    targetMeanPrice: numberOrNull(financial.targetMeanPrice?.raw),
    targetHighPrice: numberOrNull(financial.targetHighPrice?.raw),
    targetLowPrice: numberOrNull(financial.targetLowPrice?.raw),
    recommendation: financial.recommendationKey || "",
    // Canonical field names so downstream (financialQuality / financialsToMarkdown /
    // valuation) can actually read Yahoo data when FMP is rate-limited/unavailable.
    // Without these the Yahoo fallback returned providerStatus:"ok" but all-null,
    // which surfaced as "基本面未核到 + 无估值条".
    period: "TTM",
    revenue: numberOrNull(financial.totalRevenue?.raw),
    grossProfit: numberOrNull(financial.grossProfits?.raw),
    grossMargin: numberOrNull(financial.grossMargins?.raw != null ? financial.grossMargins.raw * 100 : null),
    operatingMargin: numberOrNull(financial.operatingMargins?.raw != null ? financial.operatingMargins.raw * 100 : null),
    netMargin: numberOrNull(financial.profitMargins?.raw != null ? financial.profitMargins.raw * 100 : null),
    eps: numberOrNull(stats.trailingEps?.raw ?? currentEstimate?.epsTrend?.current ?? stats.forwardEps?.raw),
    freeCashFlow: numberOrNull(financial.freeCashflow?.raw),
    operatingCashFlow: numberOrNull(financial.operatingCashflow?.raw),
    cashAndEquivalents: numberOrNull(financial.totalCash?.raw),
    pe: numberOrNull(stats.trailingPE?.raw),
    asOf: new Date().toISOString(),
    providerStatus: "ok"
  };
}

// ─── Tencent Finance (免费港股/A股基础财务数据) ──────────────────────

async function fetchTencentFinancials(ticker) {
  const url = `https://qt.gtimg.cn/q=${tencentSymbol(ticker)}`;
  const buffer = await fetchBuffer(url, { timeoutMs: 5000 });
  const text = decodeGb2312(buffer);
  const match = text.match(/="(.+)";?\s*$/);
  if (!match) throw new Error("Tencent Finance 没有返回数据");
  const fields = match[1].split("~");
  const price = numberOrNull(fields[3]);
  if (!price) throw new Error("Tencent Finance 缺少价格");

  const pe = numberOrNull(fields[39]);
  const marketCapShares = numberOrNull(fields[44]);
  const marketCap = marketCapShares ? marketCapShares * 100000000 : null;
  const pb = numberOrNull(fields[43]);
  const high = numberOrNull(fields[33]);
  const low = numberOrNull(fields[34]);
  const change = numberOrNull(fields[31]);
  const changePercent = numberOrNull(fields[32]);
  // field[57] 是 HK/US 报价格式下的 EPS，但 A 股报价格式里同一位置是成交额（万元），
  // 实测贵州茅台曾把 622334.36（当日成交额）当成 EPS 塞进估值引擎——A 股这里诚实留空，
  // 真实 EPS 靠 cn_financials 一手数据补（mergeCnFinancialGaps），不能瞎猜哪个字段对。
  const eps = detectMarket(ticker) === "CN" ? null : numberOrNull(fields[57]);
  const stockName = fields[1] || marketLabel(ticker);

  return {
    source: `腾讯财经 · ${stockName}`,
    ticker: normalizeTicker(ticker),
    period: "",
    currency: marketCurrency(ticker),
    price,
    pe,
    marketCap,
    totalAssets: null,
    totalLiability: null,
    equity: null,
    // B-5：字段名对齐其它源（FMP/Finnhub/Yahoo 都叫 sharesOutstanding）——此前叫 totalShares，
    // valuationEngine 的 EV/Sales 情景硬性要求 sharesOutstanding，字段名不对导致这个值从未
    // 被估值引擎读到过，纯港股（无 FMP/Finnhub 三表）从没能算出 EV/Sales。
    sharesOutstanding: marketCap && price ? Math.round(marketCap / price) : null,
    high,
    low,
    change,
    changePercent,
    revenue: null,
    revenueGrowth: null,
    grossProfit: null,
    grossMargin: null,
    operatingIncome: null,
    operatingMargin: null,
    netIncome: null,
    netMargin: null,
    profitGrowth: null,
    eps,
    freeCashFlow: null,
    operatingCashFlow: null,
    netDebt: null,
    cashAndEquivalents: null,
    shareholdersEquity: null,
    capitalExpenditure: null,
    dividendPaid: null,
    repurchaseOfStock: null,
    forwardPE: null,
    debtToEquity: null,
    pb,
    returnOnEquity: null,
    returnOnAssets: null,
    week52High: numberOrNull(fields[48]),
    week52Low: numberOrNull(fields[49]),
    asOf: new Date().toISOString(),
    providerStatus: "ok",
    note: "基础数据（PE、PB、市值、价格），详细财报需配置 FMP_API_KEY"
  };
}

async function fetchBuffer(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 EchoResearch/1.0",
        Accept: "text/plain,*/*",
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`${response.status}`);
    const ab = await response.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

function decodeGb2312(buffer) {
  try {
    return new TextDecoder("gbk", { fatal: false }).decode(buffer);
  } catch {
    return buffer.toString("binary");
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 EchoResearch/1.0",
        Accept: "text/plain,*/*",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 160)}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ─── 统一出口 ────────────────────────────────────────────────────────

async function tryProviders(providers) {
  const errors = [];
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { providerStatus: "missing", errors, asOf: new Date().toISOString() };
}

export async function getFinancials(ticker) {
  return tryProviders([
    () => fetchFmpFinancials(ticker),
    () => fetchFinnhubFinancials(ticker),
    () => fetchYahooStatistics(ticker),
    () => fetchTencentFinancials(ticker)
  ]);
}

export async function getCompanyProfile(ticker) {
  return tryProviders([
    () => fetchFmpCompanyProfile(ticker),
    () => fetchYahooStatistics(ticker)
  ]);
}

// 仅取一致目标价（quoteSummary/financialData）。Yahoo 偶尔反爬 403，所以只当"尽力
// 而为"的补充：买卖分布走 Finnhub（稳定），目标价能从 Yahoo 拿到就叠加，拿不到不报错。
async function fetchYahooPriceTarget(ticker) {
  const symbol = normalizeTicker(ticker);
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData`,
    { timeoutMs: 6000 }
  );
  const fin = data.quoteSummary?.result?.[0]?.financialData || {};
  const mean = numberOrNull(fin.targetMeanPrice?.raw);
  if (!mean) throw new Error("Yahoo 没有返回一致目标价");
  return {
    consensusTargetPrice: mean,
    targetHigh: numberOrNull(fin.targetHighPrice?.raw),
    targetLow: numberOrNull(fin.targetLowPrice?.raw),
    targetMedian: numberOrNull(fin.targetMedianPrice?.raw),
    numberOfAnalysts: numberOrNull(fin.numberOfAnalystOpinions?.raw)
  };
}

export async function getAnalystEstimates(ticker) {
  // 分布/共识：FMP grades（常 gated）→ Finnhub recommendation（免费稳定）。
  const base = await tryProviders([
    () => fetchFmpAnalystEstimates(ticker),
    () => fetchFinnhubRecommendation(ticker)
  ]);
  // 目标价：base 没带（Finnhub 不含目标价）时用 Yahoo 兜底，叠加到分布上。
  if (numberOrNull(base.consensusTargetPrice) === null) {
    try {
      const target = await fetchYahooPriceTarget(ticker);
      const had = base.providerStatus === "ok";
      Object.assign(base, target, {
        providerStatus: "ok",
        source: had ? `${base.source} + Yahoo 目标价` : "Yahoo 目标价",
        asOf: new Date().toISOString()
      });
    } catch { /* 目标价拿不到：只用买卖分布即可 */ }
  }
  return base;
}

export async function getDividendHistory(ticker) {
  return tryProviders([
    () => fetchFmpDividendHistory(ticker)
  ]);
}

// ─── Markdown 序列化 ─────────────────────────────────────────────────

export function financialsToMarkdown(financials) {
  if (!financials || financials.providerStatus !== "ok") {
    return "财务数据：尚未接入可用财报源。模型必须把财务数据缺失标记为缺口。";
  }

  const fmt = (value, suffix = "") => (value !== null && value !== undefined ? `${value}${suffix}` : "缺失");
  const fmtPercent = (value) => (value !== null && value !== undefined ? `${value.toFixed(1)}%` : "缺失");
  const fmtCompact = (value) => (value !== null && value !== undefined ? compactNumber(value) : "缺失");
  const period = financials.period ? `（${financials.period}）` : "";

  const seg = financials.segments?.segments?.length
    ? `\n分部收入（${financials.segments.period || "最新期"}，来源 ${financials.segments.source || "FMP"}）：\n${financials.segments.segments
        .map((s) => `- ${s.name}：${compactNumber(s.value)}${s.pct != null ? `（占 ${s.pct}%）` : ""}`)
        .join("\n")}`
    : "";

  const hk = hkFilingsToMarkdown(financials.hkFilings);
  const hkBuyback = hkBuybackToMarkdown(financials.hkBuybacks);

  // F-4a：内部人净买卖（SEC Form 4，近 180 天）——只在真实抓到数据时才出现在事实块里，
  // 没有 insiderActivity 字段（港股/请求失败）时这段整体不出现，不写"未核到"占位行
  // （港股这条本就不该出现，写"未核到"反而暗示"本该有但没查到"，误导用户）。
  const ia = financials.insiderActivity;
  const insider = ia && ia.providerStatus === "ok"
    ? `\n内部人净买卖（SEC Form 4，近 180 天，仅统计公开市场真实买卖 P/S，不含期权行权/税务代扣）：\n- 净${ia.netShares >= 0 ? "买入" : "卖出"} ${Math.abs(ia.netShares).toLocaleString("en-US")} 股${ia.netValueUsd ? `，净值约 ${compactNumber(Math.abs(ia.netValueUsd))} 美元` : ""}\n- ${ia.buyCount} 次买入、${ia.sellCount} 次卖出，涉及 ${ia.distinctInsiders} 位内部人${ia.lastTransactionAt ? `，最近一次 ${ia.lastTransactionAt}` : ""}`
    : "";

  // F-5：历史估值分位——近似口径（年度财年末 PE 快照，非逐日分布），必须显式标注，
  // 不能让读者误以为这是精确的逐日分布分位（PLAN.md 红线11）。没有数据时整段不出现。
  const hv = financials.historicalValuation;
  const historicalValuationBlock = hv && hv.providerStatus === "ok"
    ? `\n历史估值分位（近似口径：年度财年末 PE 快照分布，非逐日分布，样本 ${hv.sampleYears} 年，${hv.oldestPeriod}~${hv.newestPeriod}）：\n- 当前 PE ${hv.currentValue.toFixed(1)} 处于历史第 ${hv.percentile} 百分位（历史区间 ${hv.min.toFixed(1)}~${hv.max.toFixed(1)}，中位 ${hv.median.toFixed(1)}）`
    : "";

  return [
    `财务数据来源：${financials.source}${period}（唯一财务事实源——下列没有的财务数字一律写"未核到"，禁止编造或估算）`,
    `收入${financials.period ? `（${financials.period}）` : "（TTM）"}：${fmtCompact(financials.revenue)} | 增速：${fmt(financials.revenueGrowth, "%")}`,
    financials.revenueTrend ? `收入增速趋势（近 ${financials.revenueTrend.series.length + 1} 期年报）：${financials.revenueTrend.label}` : "",
    `毛利：${fmtCompact(financials.grossProfit)} | 毛利率：${fmtPercent(financials.grossMargin)}`,
    `经营利润：${fmtCompact(financials.operatingIncome)} | 经营利润率：${fmtPercent(financials.operatingMargin)}`,
    `净利润：${fmtCompact(financials.netIncome)} | 净利率：${fmtPercent(financials.netMargin)}`,
    `利润增速：${fmt(financials.profitGrowth, "%")}`,
    financials.profitTrend ? `利润增速趋势（近 ${financials.profitTrend.series.length + 1} 期年报）：${financials.profitTrend.label}` : "",
    `EPS：${fmt(financials.eps)}`,
    `自由现金流：${fmtCompact(financials.freeCashFlow)}`,
    `经营现金流：${fmtCompact(financials.operatingCashFlow)}`,
    `净债务：${fmtCompact(financials.netDebt)}`,
    `现金及等价物：${fmtCompact(financials.cashAndEquivalents)}`,
    `回购金额：${fmtCompact(financials.repurchaseOfStock)}`,
    `分红：${fmtCompact(financials.dividendPaid)}`,
    financials.forwardPE ? `Forward PE：${financials.forwardPE}` : "Forward PE：缺失",
    financials.pe ? `PE（TTM）：${financials.pe}` : "",
    financials.debtToEquity ? `资产负债率：${financials.debtToEquity}` : "",
    financials.returnOnEquity ? `ROE：${fmtPercent(financials.returnOnEquity)}` : "",
    financials.returnOnAssets ? `ROA：${fmtPercent(financials.returnOnAssets)}` : ""
  ].filter(Boolean).join("\n") + seg + hk + hkBuyback + insider + historicalValuationBlock;
}

/**
 * 港股一手财报块（P7）：hk_financials 行 → 事实块 markdown。
 * 每行来自一份 HKEX 业绩公告 PDF 的直接抽取，来源必须标注公告链接——
 * 与第三方口径（FMP/Finnhub）冲突时以此为准。
 */
export function hkFilingsToMarkdown(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const yoy = (cur, prior) => {
    if (cur == null || !prior) return "";
    const pct = ((cur - prior) / Math.abs(prior)) * 100;
    return `（同比 ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%）`;
  };
  const lines = rows.slice(0, 3).map((r) => {
    const parts = [
      r.revenue != null ? `收入 ${compactNumber(r.revenue)}${yoy(r.revenue, r.revenue_prior)}` : "",
      r.gross_profit != null ? `毛利 ${compactNumber(r.gross_profit)}` : "",
      r.operating_income != null ? `经营盈利 ${compactNumber(r.operating_income)}${yoy(r.operating_income, r.operating_income_prior)}` : "",
      r.net_income != null ? `净利 ${compactNumber(r.net_income)}${yoy(r.net_income, r.net_income_prior)}` : "",
      r.eps != null ? `EPS(基本) ${r.eps}` : "",
      r.operating_cash_flow != null ? `经营现金流 ${compactNumber(r.operating_cash_flow)}` : "",
      r.net_cash != null ? `净现金 ${compactNumber(r.net_cash)}` : ""
    ].filter(Boolean).join(" | ");
    const date = (r.published_at || "").slice(0, 10);
    return `- ${r.period_label || r.period_end}：${parts}（币种 ${r.currency || "未知"}）｜来源：[${r.source_title || "业绩公告"}](${r.source_url})${date ? `（${date} 发布）` : ""}`;
  });
  const cnyNote = rows[0]?.currency === "CNY" ? "\n注意：该公司以人民币列报，而股价为港元——跨币种换算估值时需按汇率折算。" : "";
  return `\n\n港股一手财报（HKEX 业绩公告 PDF 直接抽取，数字与第三方源冲突时以此为准）：\n${lines.join("\n")}${cnyNote}`;
}

/**
 * 港股回购一手事实块（F-4b）：HKEX 翌日披露报表（真实购回，仅统计场内公开购回，
 * 不含尚未真实成交的授权额度）。rows 假定新→旧排序（listRecentHkBuybacks 的返回顺序）。
 * 股本趋势特意标注"购回股份注销有滞后"——HKEX 规则下，购回股份在正式注销完成前仍计入
 * 已发行股份总数，这里能看到的只是"逐次披露间已发行股份数的变化"这条粗线，不是
 * "购回后即时净股本"，禁止把这条近似趋势说成精确的即时股本变化。
 */
export function hkBuybackToMarkdown(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const totalShares = rows.reduce((sum, r) => sum + (r.shares_repurchased || 0), 0);
  const totalConsideration = rows.reduce((sum, r) => sum + (r.total_consideration || 0), 0);
  const currency = rows[0]?.currency || "HKD";
  const latest = rows[0];
  const oldest = rows[rows.length - 1];
  const shareTrend = latest.shares_issued_total != null && oldest.shares_issued_total != null && latest.period_end_date !== oldest.period_end_date
    ? `\n- 已发行股份（不含库存股，粗线趋势——购回注销有滞后，非即时净股本）：${oldest.period_end_date} ${Number(oldest.shares_issued_total).toLocaleString("en-US")} 股 → ${latest.period_end_date} ${Number(latest.shares_issued_total).toLocaleString("en-US")} 股`
    : "";
  return `\n\n港股回购（HKEX 翌日披露报表，近 ${rows.length} 次真实场内购回，${oldest.trade_date}~${latest.trade_date}）：\n- 累计购回 ${totalShares.toLocaleString("en-US")} 股，总代价约 ${compactNumber(totalConsideration)} ${currency}${shareTrend}`;
}

export function companyProfileToMarkdown(profile) {
  if (!profile || profile.providerStatus !== "ok") {
    return "公司画像：尚未接入数据源。";
  }

  return [
    `公司画像来源：${profile.source}`,
    profile.companyName ? `公司名：${profile.companyName}` : "",
    profile.description ? `简介：${profile.description.slice(0, 500)}` : "",
    profile.industry ? `行业：${profile.industry}` : "",
    profile.sector ? `板块：${profile.sector}` : "",
    profile.employees ? `全职员工：${profile.employees.toLocaleString()}` : "",
    profile.ceo ? `CEO：${profile.ceo}` : "",
    profile.forwardPE ? `Forward PE：${profile.forwardPE}` : "",
    profile.dividendYield ? `股息率：${profile.dividendYield.toFixed(2)}%` : "",
    profile.beta ? `Beta：${profile.beta.toFixed(2)}` : ""
  ].filter(Boolean).join("\n");
}

export function analystEstimatesToMarkdown(estimates) {
  if (!estimates || estimates.providerStatus !== "ok") {
    return "分析师评级：尚未接入数据源。模型不能编造评级信息。";
  }

  const lines = [`分析师评级来源：${estimates.source}`];

  if (estimates.consensusTargetPrice) {
    lines.push(`一致目标价：${estimates.consensusTargetPrice}`);
  }
  if (estimates.targetHigh) lines.push(`最高目标价：${estimates.targetHigh}`);
  if (estimates.targetLow) lines.push(`最低目标价：${estimates.targetLow}`);
  if (estimates.targetMedian) lines.push(`中位目标价：${estimates.targetMedian}`);

  if (estimates.ratings?.length) {
    lines.push("最近评级：");
    for (const r of estimates.ratings) {
      lines.push(`- ${r.date} ${r.firm}：${r.grade}（${r.action}）`);
    }
  }

  if (estimates.consensus) {
    lines.push(`共识方向：${estimates.consensus}`);
  }
  if (estimates.buy !== undefined) {
    lines.push(`买入 ${estimates.strongBuy + estimates.buy} / 持有 ${estimates.hold} / 卖出 ${estimates.strongSell + estimates.sell}`);
  }

  return lines.join("\n");
}

export function dividendHistoryToMarkdown(dividends) {
  if (!dividends || dividends.providerStatus !== "ok") {
    return "分红历史：尚未接入数据源。";
  }

  const lines = [`分红历史来源：${dividends.source}`];
  if (dividends.dividends?.length) {
    for (const d of dividends.dividends) {
      lines.push(`- ${d.date}：${d.dividend ?? d.adjDividend ?? "缺失"}`);
    }
  }
  return lines.join("\n");
}
