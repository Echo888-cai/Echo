import { normalizeTicker } from "./data.js";
import { fmpSymbol, finnhubSymbol, tencentSymbol, hkCode, detectMarket } from "./market.js";
import { fmpGet, FMP_TTL } from "./fmpClient.js";

function env(name) {
  return process.env[name] || "";
}

function toHongKongSymbol(ticker) {
  return hkCode(ticker).replace(/^0+(?=\d)/, "");
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

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Luvio/0.1 financial data adapter",
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
  const [incomeStmt, balanceSheet, cashFlow] = await Promise.all([
    fmpGet("/stable/income-statement", { symbol, limit: 2 }, { ttl: FMP_TTL.financials, timeoutMs: 10000 }),
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

  return {
    source: "FMP",
    ticker: normalizeTicker(ticker),
    period: latest.date || "",
    currency: latest.reportedCurrency || "HKD",
    revenue: numberOrNull(latest.revenue),
    revenueGrowth: numberOrNull(revenueGrowth),
    grossProfit: numberOrNull(latest.grossProfit),
    grossMargin: latest.revenue ? numberOrNull((latest.grossProfit / latest.revenue) * 100) : null,
    operatingIncome: numberOrNull(latest.operatingIncome),
    operatingMargin: latest.revenue ? numberOrNull((latest.operatingIncome / latest.revenue) * 100) : null,
    netIncome: numberOrNull(latest.netIncome),
    netMargin: latest.revenue ? numberOrNull((latest.netIncome / latest.revenue) * 100) : null,
    profitGrowth: numberOrNull(profitGrowth),
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

  // 付费端点：能拿到绝对额（营收/净利）就补充，拿不到就只用 metric 的比率。
  let annual = null;
  try {
    const fin = await fetchJson(
      `https://finnhub.io/api/v1/stock/financials?symbol=${encodeURIComponent(symbol)}&statement=ic&freq=annually&token=${apiKey}`,
      { timeoutMs: 6000 }
    );
    annual = fin?.financials?.[0] || null;
  } catch { /* 付费端点不可用：跳过绝对额 */ }

  const pick = (...vals) => {
    for (const v of vals) {
      const n = numberOrNull(v);
      if (n !== null) return n;
    }
    return null;
  };

  return {
    source: "Finnhub",
    ticker: normalizeTicker(ticker),
    period: annual?.period || "TTM",
    currency: detectMarket(ticker) === "US" ? "USD" : "HKD",
    revenue: pick(annual?.revenue),
    revenueGrowth: pick(m.revenueGrowthTTMYoy, m.revenueGrowthQuarterlyYoy, m.revenueGrowth5Y),
    grossProfit: pick(annual?.grossIncome),
    grossMargin: pick(m.grossMarginTTM, m.grossMarginAnnual, m.grossMargin5Y),
    operatingIncome: pick(annual?.operatingIncome),
    operatingMargin: pick(m.operatingMarginTTM, m.operatingMarginAnnual, m.operatingMargin5Y),
    netIncome: pick(annual?.netIncome),
    netMargin: pick(m.netProfitMarginTTM, m.netProfitMarginAnnual, m.netProfitMargin5Y),
    profitGrowth: pick(m.epsGrowthTTMYoy, m.epsGrowth5Y, m.netMarginGrowth5Y),
    eps: pick(m.epsTTM, m.epsInclExtraItemsTTM, m.epsAnnual),
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

// ─── Tencent Finance (免费港股基础财务数据) ──────────────────────────

function toTencentHongKongSymbol(ticker) {
  const code = toHongKongSymbol(ticker);
  return `hk${code.padStart(5, "0")}`;
}

async function fetchTencentFinancials(ticker) {
  const url = `https://qt.gtimg.cn/q=${toTencentHongKongSymbol(ticker)}`;
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
  const eps = numberOrNull(fields[57]);
  const stockName = fields[1] || "港股";

  return {
    source: `腾讯财经 · ${stockName}`,
    ticker: normalizeTicker(ticker),
    period: "",
    currency: "HKD",
    price,
    pe,
    marketCap,
    totalAssets: null,
    totalLiability: null,
    equity: null,
    totalShares: marketCap && price ? Math.round(marketCap / price) : null,
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
        "User-Agent": "Mozilla/5.0 Luvio/0.1",
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
        "User-Agent": "Mozilla/5.0 Luvio/0.1",
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

  return [
    `财务数据来源：${financials.source}${period}`,
    `收入：${fmtCompact(financials.revenue)} | 增速：${fmt(financials.revenueGrowth, "%")}`,
    `毛利：${fmtCompact(financials.grossProfit)} | 毛利率：${fmtPercent(financials.grossMargin)}`,
    `经营利润：${fmtCompact(financials.operatingIncome)} | 经营利润率：${fmtPercent(financials.operatingMargin)}`,
    `净利润：${fmtCompact(financials.netIncome)} | 净利率：${fmtPercent(financials.netMargin)}`,
    `利润增速：${fmt(financials.profitGrowth, "%")}`,
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
  ].filter(Boolean).join("\n") + seg;
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
