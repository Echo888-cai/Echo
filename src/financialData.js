import { normalizeTicker } from "./data.js";
import { fmpSymbol, finnhubSymbol, tencentSymbol, hkCode } from "./market.js";

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
  const apiKey = env("FMP_API_KEY");
  if (!apiKey) throw new Error("missing FMP_API_KEY");
  const symbol = toFmpSymbol(ticker);

  const sym = encodeURIComponent(symbol);
  const [incomeStmt, balanceSheet, cashFlow] = await Promise.all([
    fetchJson(`https://financialmodelingprep.com/stable/income-statement?symbol=${sym}&limit=2&apikey=${apiKey}`, { timeoutMs: 10000 }),
    fetchJson(`https://financialmodelingprep.com/stable/balance-sheet-statement?symbol=${sym}&limit=2&apikey=${apiKey}`, { timeoutMs: 10000 }),
    fetchJson(`https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${sym}&limit=2&apikey=${apiKey}`, { timeoutMs: 10000 })
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
  const apiKey = env("FMP_API_KEY");
  if (!apiKey) throw new Error("missing FMP_API_KEY");
  const symbol = toFmpSymbol(ticker);

  const profile = await fetchJson(`https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`, { timeoutMs: 5000 });
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
  const apiKey = env("FMP_API_KEY");
  if (!apiKey) throw new Error("missing FMP_API_KEY");
  const symbol = toFmpSymbol(ticker);

  const sym = encodeURIComponent(symbol);
  const [ratings, priceTarget] = await Promise.all([
    fetchJson(`https://financialmodelingprep.com/stable/grades?symbol=${sym}&limit=5&apikey=${apiKey}`, { timeoutMs: 5000 }),
    fetchJson(`https://financialmodelingprep.com/stable/price-target-consensus?symbol=${sym}&apikey=${apiKey}`, { timeoutMs: 5000 })
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
  const apiKey = env("FMP_API_KEY");
  if (!apiKey) throw new Error("missing FMP_API_KEY");
  const symbol = toFmpSymbol(ticker);

  const dividends = await fetchJson(`https://financialmodelingprep.com/stable/dividends?symbol=${encodeURIComponent(symbol)}&limit=8&apikey=${apiKey}`, { timeoutMs: 5000 });
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

// ─── Finnhub (扩展已有 key) ──────────────────────────────────────────

async function fetchFinnhubFinancials(ticker) {
  const apiKey = env("FINNHUB_API_KEY");
  if (!apiKey) throw new Error("missing FINNHUB_API_KEY");
  const symbol = finnhubSymbol(ticker);

  const [financials, metrics] = await Promise.all([
    fetchJson(`https://finnhub.io/api/v1/stock/financials?symbol=${encodeURIComponent(symbol)}&statement=ic&freq=annually&token=${apiKey}`, { timeoutMs: 6000 }),
    fetchJson(`https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey}`, { timeoutMs: 6000 })
  ]);

  const annualData = financials?.financials?.[0];
  const metricData = metrics?.metric || {};
  const seriesData = metrics?.series?.annual || {};

  if (!annualData && !Object.keys(metricData).length) throw new Error("Finnhub 没有返回财务数据");

  const revenue = numberOrNull(annualData?.revenue || metricData.revenueGrowth5Y ? null : null);
  const netIncome = numberOrNull(annualData?.netIncome || null);
  const grossMargin = numberOrNull(metricData.grossMargin || annualData?.grossMargin);
  const operatingMargin = numberOrNull(metricData.operatingMargin || annualData?.operatingMargin);
  const revenueGrowth = numberOrNull(metricData.revenueGrowthQ || metricData.revenueGrowthTTM || metricData["5YRevenueGrowthPerShare"]);
  const profitGrowth = numberOrNull(metricData.netIncomeGrowth5Y || metricData.netMarginGrowth5Y);

  return {
    source: "Finnhub",
    ticker: normalizeTicker(ticker),
    period: annualData?.period || "",
    currency: "HKD",
    revenue,
    revenueGrowth,
    grossMargin,
    operatingMargin,
    netIncome,
    netMargin: numberOrNull(metricData.netMargin || annualData?.netMargin),
    profitGrowth,
    eps: numberOrNull(metricData.epsInclExtraItemsTTM || annualData?.eps),
    freeCashFlow: numberOrNull(metricData.freeCashFlowPerShareTTM ? metricData.freeCashFlowPerShareTTM : null),
    forwardPE: numberOrNull(metricData.forwardPE),
    pe: numberOrNull(metricData.peNormalizedAnnual || metricData.peInclExtraTTM || metricData.peExclExtraTTM),
    peRatio: numberOrNull(metricData.peRatio),
    pegRatio: numberOrNull(metricData.pegRatio),
    dividendYield: numberOrNull(metricData.dividendYieldIndicatedAnnual),
    currentRatio: numberOrNull(metricData.currentRatio),
    quickRatio: numberOrNull(metricData.quickRatio),
    debtToEquity: numberOrNull(metricData.totalDebtToEquity || metricData.totalDebtToTotalAssets),
    returnOnEquity: numberOrNull(metricData.roeTTM || metricData.returnOnEquity),
    returnOnAssets: numberOrNull(metricData.roaTTM || metricData.returnOnAssets),
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

export async function getAnalystEstimates(ticker) {
  return tryProviders([
    () => fetchFmpAnalystEstimates(ticker),
    () => fetchFinnhubRecommendation(ticker)
  ]);
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
  ].filter(Boolean).join("\n");
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
