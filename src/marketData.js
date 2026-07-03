import { normalizeTicker } from "./data.js";
import {
  detectMarket,
  marketCurrency,
  tencentSymbol as toTencentHongKongSymbol,
  finnhubSymbol,
  alphaVantageSymbol as toAlphaVantageSymbol,
  twelveDataSymbol as toTwelveDataSymbol,
  yahooSymbol as toYahooSymbol
} from "./market.js";

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

function buildSnapshot(source, ticker, data) {
  return {
    source,
    ticker: normalizeTicker(ticker),
    currency: data.currency || marketCurrency(ticker),
    price: numberOrNull(data.price),
    previousClose: numberOrNull(data.previousClose),
    change: numberOrNull(data.change),
    changePercent: numberOrNull(data.changePercent),
    open: numberOrNull(data.open),
    high: numberOrNull(data.high),
    low: numberOrNull(data.low),
    volume: numberOrNull(data.volume),
    marketCap: data.marketCap ? compactNumber(data.marketCap) : null,
    pe: numberOrNull(data.pe),
    dividendYield: numberOrNull(data.dividendYield),
    week52High: numberOrNull(data.week52High),
    week52Low: numberOrNull(data.week52Low),
    asOf: data.asOf || new Date().toISOString(),
    providerStatus: "ok"
  };
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 4500);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": "Luvio/0.1 research data adapter",
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${response.status} ${text.slice(0, 160)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 4500);
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
    if (!response.ok) {
      throw new Error(`${response.status} ${text.slice(0, 160)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTencentQuote(ticker) {
  const symbol = toTencentHongKongSymbol(ticker);
  const text = await fetchText(`https://qt.gtimg.cn/q=${symbol}`);
  const match = text.match(/="(.+)";?\s*$/);
  if (!match) throw new Error("Tencent quote 没有返回报价");
  const fields = match[1].split("~");
  const price = numberOrNull(fields[3]);
  if (!price) throw new Error("Tencent quote 缺少价格");
  return buildSnapshot("Tencent Finance", ticker, {
    currency: "HKD",
    price,
    previousClose: fields[4],
    open: fields[5],
    volume: fields[36] || fields[6],
    change: fields[31],
    changePercent: fields[32],
    high: fields[33],
    low: fields[34],
    pe: fields[39],
    marketCap: fields[44] ? Number(fields[44]) * 100000000 : null,
    week52High: fields[48],
    week52Low: fields[49],
    asOf: fields[30] ? `${fields[30].replaceAll("/", "-").replace(" ", "T")}+08:00` : undefined
  });
}

async function fetchAlphaVantage(ticker) {
  const apiKey = env("ALPHAVANTAGE_API_KEY");
  if (!apiKey) throw new Error("missing ALPHAVANTAGE_API_KEY");
  const symbol = toAlphaVantageSymbol(ticker);
  const quote = await fetchJson(
    `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
  );
  const row = quote["Global Quote"];
  if (!row || Object.keys(row).length === 0) throw new Error("Alpha Vantage 没有返回报价");
  return buildSnapshot("Alpha Vantage", ticker, {
    price: row["05. price"],
    previousClose: row["08. previous close"],
    change: row["09. change"],
    changePercent: String(row["10. change percent"] || "").replace("%", ""),
    open: row["02. open"],
    high: row["03. high"],
    low: row["04. low"],
    volume: row["06. volume"],
    asOf: row["07. latest trading day"] ? `${row["07. latest trading day"]}T16:00:00+08:00` : undefined
  });
}

async function fetchTwelveData(ticker) {
  const apiKey = env("TWELVEDATA_API_KEY");
  if (!apiKey) throw new Error("missing TWELVEDATA_API_KEY");
  const symbol = toTwelveDataSymbol(ticker);
  const quote = await fetchJson(
    `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`
  );
  if (quote.status === "error") throw new Error(quote.message || "Twelve Data 报错");
  return buildSnapshot("Twelve Data", ticker, {
    currency: quote.currency,
    price: quote.close,
    previousClose: quote.previous_close,
    change: quote.change,
    changePercent: quote.percent_change,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    volume: quote.volume,
    asOf: quote.datetime ? `${quote.datetime}T16:00:00+08:00` : undefined
  });
}

async function fetchFinnhub(ticker) {
  const apiKey = env("FINNHUB_API_KEY");
  if (!apiKey) throw new Error("missing FINNHUB_API_KEY");
  const symbol = finnhubSymbol(ticker);
  const quote = await fetchJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`);
  if (!quote || quote.c === 0) throw new Error("Finnhub 没有返回报价");
  return buildSnapshot("Finnhub", ticker, {
    price: quote.c,
    previousClose: quote.pc,
    change: quote.d,
    changePercent: quote.dp,
    open: quote.o,
    high: quote.h,
    low: quote.l,
    asOf: quote.t ? new Date(quote.t * 1000).toISOString() : undefined
  });
}

async function fetchYahooChart(ticker) {
  const symbol = toYahooSymbol(ticker);
  const chart = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`);
  const result = chart.chart?.result?.[0];
  if (!result) throw new Error(chart.chart?.error?.description || "Yahoo 没有返回图表");
  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const lastIndex = (result.timestamp || []).length - 1;
  return buildSnapshot("Yahoo Finance", ticker, {
    currency: meta.currency,
    price: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose || meta.previousClose,
    open: quote.open?.[lastIndex],
    high: quote.high?.[lastIndex],
    low: quote.low?.[lastIndex],
    volume: quote.volume?.[lastIndex],
    asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : undefined
  });
}

export async function getMarketSnapshot(ticker) {
  // 第一梯队**并发竞速**（取最快成功的），其余作串行兜底。
  // 之前是纯串行兜底：每个源 fetch 超时 4.5s，并发研究时 Finnhub quote 又被新闻
  // (company-news 大包) / 评级同时抢占，一慢就拖到 5s+ 撞上游超时 → 行情槽经常 missing。
  // 竞速把延迟压到最快源即可返回。只让额度宽裕的源参与竞速（Finnhub 60/min、
  // TwelveData 8/min、腾讯免费）；AlphaVantage 免费仅 25/天，留作兜底不参与竞速。
  const isUS = detectMarket(ticker) === "US";
  const fast = isUS ? [fetchFinnhub, fetchTwelveData] : [fetchTencentQuote, fetchFinnhub];
  const fallback = isUS
    ? [fetchAlphaVantage, fetchYahooChart]
    : [fetchTwelveData, fetchAlphaVantage, fetchYahooChart];
  const errors = [];
  try {
    return await Promise.any(fast.map((provider) => provider(ticker)));
  } catch (aggregate) {
    for (const err of aggregate?.errors || []) errors.push(err?.message || String(err));
  }
  for (const provider of fallback) {
    try {
      return await provider(ticker);
    } catch (error) {
      errors.push(error.message);
    }
  }
  return {
    source: "未接入",
    ticker: normalizeTicker(ticker),
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
    errors
  };
}

// 拉日线收盘价（统一整成 newest-first），用于算区间回报。免费档历史价美股可得
// （TwelveData 主、FMP light 兜底）；港股普遍拿不到 → 返回空数组，上层优雅跳过。
async function fetchDailyCloses(ticker) {
  const normalize = (rows) =>
    rows
      .filter((v) => v && v.date && Number.isFinite(v.close))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest-first

  // TwelveData（美股 + 部分港股，但港股 free 多 404）
  if (env("TWELVEDATA_API_KEY")) {
    try {
      const symbol = toTwelveDataSymbol(ticker);
      const data = await fetchJson(
        `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=260&apikey=${env("TWELVEDATA_API_KEY")}`,
        { timeoutMs: 6000 }
      );
      const closes = normalize((Array.isArray(data?.values) ? data.values : []).map((v) => ({ date: v.datetime, close: Number(v.close) })));
      if (closes.length >= 20) return closes;
    } catch { /* fall through to FMP */ }
  }

  // FMP light（美股；免费档不覆盖港股）
  if (detectMarket(ticker) === "US" && env("FMP_API_KEY")) {
    try {
      const data = await fetchJson(
        `https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${encodeURIComponent(ticker)}&apikey=${env("FMP_API_KEY")}`,
        { timeoutMs: 6000 }
      );
      const rows = Array.isArray(data) ? data : (Array.isArray(data?.historical) ? data.historical : []);
      const closes = normalize(rows.map((r) => ({ date: r.date, close: Number(r.price ?? r.close ?? r.adjClose) })));
      if (closes.length >= 20) return closes;
    } catch { /* fall through */ }
  }
  return [];
}

// 区间回报：近 1 月 / 年初至今。给估值与动量一个时间维度（"现价相对一个月前/年初的位置"）。
// 美股可得，港股免费档拿不到 → providerStatus:"missing"（接地条/UI 不显示，诚实跳过）。
export async function getRangeReturns(ticker) {
  const closes = await fetchDailyCloses(ticker);
  if (closes.length < 20) return { providerStatus: "missing", oneMonthPct: null, ytdPct: null };
  const latest = closes[0];
  const pctFrom = (base) => (base && base.close ? Number((((latest.close - base.close) / base.close) * 100).toFixed(1)) : null);
  const latestDate = new Date(latest.date);
  const monthAgo = new Date(latestDate);
  monthAgo.setDate(monthAgo.getDate() - 30);
  const monthAgoStr = monthAgo.toISOString().slice(0, 10);
  const yearStart = `${latestDate.getFullYear()}-01-01`;
  // 近 1 月：最近一个日期 ≤ 30 天前的收盘；年初至今：上一年最后一个交易日收盘（date < 今年元旦）。
  const m1 = closes.find((c) => c.date <= monthAgoStr);
  const ytdBase = closes.find((c) => c.date < yearStart);
  return {
    providerStatus: "ok",
    asOf: latest.date,
    latest: latest.close,
    oneMonthPct: pctFrom(m1),
    ytdPct: pctFrom(ytdBase)
  };
}

// 港股免费日线（收盘价）：腾讯 fqkline，免费、覆盖港股主板，qfqday=[日期,开,收,高,低,量,...]，
// oldest-first。用户明确"港股不付费，免费有啥用啥"，所以走这条免费腿，拿不到就诚实留空。
async function fetchTencentDailyCloses(ticker) {
  if (detectMarket(ticker) === "US") return [];
  const symbol = toTencentHongKongSymbol(ticker); // 0700.HK → hk00700
  if (!symbol) return [];
  try {
    const data = await fetchJson(
      `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,320,qfq`,
      { timeoutMs: 6000 }
    );
    const node = data?.data?.[symbol] || {};
    const rows = Array.isArray(node.qfqday) ? node.qfqday : (Array.isArray(node.day) ? node.day : []);
    return rows
      .map((r) => ({ date: r[0], close: Number(r[2]) }))
      .filter((p) => p.date && Number.isFinite(p.close)); // oldest-first
  } catch {
    return [];
  }
}

// 价格曲线序列（公司页真曲线 + 看盘行内 sparkline）。收盘价日线，oldest-first。
// 美股：TwelveData 主、FMP light 兜底（fetchDailyCloses）。港股：腾讯免费日K。
// 任一都拿不到 → providerStatus:"missing"，UI 诚实显示"暂不可用"（不再区分付费/预留）。
// 进程内 TTL 缓存：日线一天最多变一次，30 分钟内看盘整盘刷新/多次进出个股页
// 不再反复打行情源（免费额度有限，30 家并发拉序列会瞬间打爆 TwelveData）。
const priceSeriesCache = new Map(); // ticker -> { at, value }
const PRICE_SERIES_TTL_MS = 30 * 60 * 1000;

export async function getPriceSeries(ticker) {
  const key = normalizeTicker(ticker) || String(ticker || "");
  const hit = priceSeriesCache.get(key);
  if (hit && Date.now() - hit.at < PRICE_SERIES_TTL_MS) return hit.value;

  let points;
  if (detectMarket(ticker) === "US") {
    const closes = await fetchDailyCloses(ticker); // newest-first
    points = closes.slice(0, 252).reverse().map((c) => ({ date: c.date, close: c.close }));
  } else {
    points = (await fetchTencentDailyCloses(ticker)).slice(-252);
  }
  if (!points || points.length < 20) return { providerStatus: "missing" }; // 失败不缓存，下轮重试
  const value = { providerStatus: "ok", asOf: points[points.length - 1].date, points };
  priceSeriesCache.set(key, { at: Date.now(), value });
  return value;
}

export function marketSnapshotToMarkdown(snapshot) {
  if (!snapshot || snapshot.providerStatus !== "ok") {
    return "实时行情：尚未接入可用行情源。";
  }
  return [
    `实时行情来源：${snapshot.source}`,
    `时间：${snapshot.asOf}`,
    `价格：${snapshot.price ?? "缺失"} ${snapshot.currency}`,
    `涨跌：${snapshot.change ?? "缺失"} / ${snapshot.changePercent ?? "缺失"}%`,
    `成交量：${snapshot.volume ?? "缺失"}`,
    `市值：${snapshot.marketCap ?? "缺失"}`,
    `PE：${snapshot.pe ?? "缺失"}`,
    `股息率：${snapshot.dividendYield ?? "缺失"}`
  ].join("\n");
}
