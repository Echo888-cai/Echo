import { normalizeTicker } from "./data.js";
import {
  detectMarket,
  marketCurrency,
  tencentSymbol as toTencentSymbol,
  sinaSymbol as toSinaSymbol,
  finnhubSymbol,
  alphaVantageSymbol as toAlphaVantageSymbol,
  twelveDataSymbol as toTwelveDataSymbol,
  yahooSymbol as toYahooSymbol
} from "./market.js";
import { fetchJson as requestJson } from "./server/utils/http.js";

const fetchJson = (url, options = {}) => requestJson(url, {
  timeoutMs: 4500,
  userAgent: "EchoResearch/1.0 research data adapter",
  ...options
});

function env(name) {
  return process.env[name] || "";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// Tencent's field[30] timestamp comes in two different formats depending on
// market: HK/US quotes use "YYYY/MM/DD HH:MM:SS", but A股 (CN) quotes use a
// compact 14-digit "YYYYMMDDHHMMSS" with no separators — feeding the latter
// through the slash/space replace produced an unparseable string (digits
// glued straight to "+08:00"), so every CN quote's asOf silently fell back to
// buildSnapshot()'s `new Date().toISOString()` default without anyone
// noticing (found via packages/data-plane's quality guard, not a report).
function tencentAsOf(raw) {
  if (!raw) return undefined;
  if (/^\d{14}$/.test(raw)) {
    const y = raw.slice(0, 4), mo = raw.slice(4, 6), d = raw.slice(6, 8);
    const h = raw.slice(8, 10), mi = raw.slice(10, 12), s = raw.slice(12, 14);
    return `${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`;
  }
  return `${raw.replaceAll("/", "-").replace(" ", "T")}+08:00`;
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

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 4500);
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
    if (!response.ok) {
      throw new Error(`${response.status} ${text.slice(0, 160)}`);
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTencentQuote(ticker) {
  const symbol = toTencentSymbol(ticker);
  const text = await fetchText(`https://qt.gtimg.cn/q=${symbol}`);
  const match = text.match(/="(.+)";?\s*$/);
  if (!match) throw new Error("Tencent quote 没有返回报价");
  const fields = match[1].split("~");
  const price = numberOrNull(fields[3]);
  if (!price) throw new Error("Tencent quote 缺少价格");
  return buildSnapshot("Tencent Finance", ticker, {
    currency: marketCurrency(ticker),
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
    asOf: tencentAsOf(fields[30])
  });
}

// 新浪财经 A 股行情：免费无 key，但非官方接口，必须带 Referer 否则拒绝；格式可能漂移，
// 仅作 A 股的第二行情源（腾讯为主），不用于港股/美股。
async function fetchSinaQuote(ticker) {
  if (detectMarket(ticker) !== "CN") throw new Error("Sina quote 仅支持 A 股");
  const symbol = toSinaSymbol(ticker);
  const text = await fetchText(`https://hq.sinajs.cn/list=${symbol}`, {
    headers: { Referer: "https://finance.sina.com.cn/" }
  });
  const match = text.match(/="(.*)";?\s*$/);
  if (!match || !match[1]) throw new Error("Sina quote 没有返回报价");
  const fields = match[1].split(",");
  const price = numberOrNull(fields[3]);
  if (!price) throw new Error("Sina quote 缺少价格");
  const previousClose = numberOrNull(fields[2]);
  return buildSnapshot("Sina Finance", ticker, {
    currency: "CNY",
    price,
    previousClose,
    open: fields[1],
    high: fields[4],
    low: fields[5],
    volume: fields[8],
    change: previousClose ? price - previousClose : null,
    changePercent: previousClose ? ((price - previousClose) / previousClose) * 100 : null,
    asOf: fields[30] && fields[31] ? `${fields[30]}T${fields[31]}+08:00` : undefined
  });
}

// EODHD 是有授权的 HTTPS 数据源。仅作公共行情源失效后的日终兜底，避免把 EOD 数据误标为实时。
async function fetchEodhdQuote(ticker) {
  const apiKey = env("EODHD_API_KEY");
  if (!apiKey) throw new Error("missing EODHD_API_KEY");
  const symbol = detectMarket(ticker) === "CN"
    ? String(ticker).toUpperCase().replace(/\.SS$/, ".SHG").replace(/\.SZ$/, ".SHE")
    : toYahooSymbol(ticker);
  const rows = await fetchJson(
    `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?api_token=${encodeURIComponent(apiKey)}&fmt=json&order=d`
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  const price = numberOrNull(row?.close);
  if (!price) throw new Error("EODHD 没有返回收盘价");
  const previousClose = numberOrNull(row?.previousClose);
  return buildSnapshot("EODHD（收盘）", ticker, {
    price,
    previousClose,
    open: row.open,
    high: row.high,
    low: row.low,
    volume: row.volume,
    change: previousClose ? price - previousClose : null,
    changePercent: previousClose ? ((price - previousClose) / previousClose) * 100 : null,
    asOf: row.date ? `${row.date}T15:00:00+08:00` : undefined
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

// Massive（原 Polygon.io）美股快照。签约后它是美股行情的质量优先源：直连交易所、
// 单标的快照同时给当日/前日 bar 与最新成交。Key 走 Authorization header，避免出现在
// URL、反代访问日志和错误追踪里。未配置时完全不进入请求路径。
export async function fetchMassiveQuote(ticker) {
  if (detectMarket(ticker) !== "US") throw new Error("Massive quote 仅支持美股");
  const apiKey = env("MASSIVE_API_KEY");
  if (!apiKey) throw new Error("missing MASSIVE_API_KEY");
  const symbol = toYahooSymbol(ticker);
  const data = await fetchJson(
    `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } }
  );
  const quote = data?.ticker;
  const price = numberOrNull(quote?.lastTrade?.p ?? quote?.day?.c);
  if (!quote || !price) throw new Error("Massive 没有返回有效快照");
  const updated = numberOrNull(quote.updated);
  const updatedMs = updated == null ? null : updated > 1e15 ? updated / 1e6 : updated > 1e12 ? updated : updated * 1000;
  return buildSnapshot("Massive", ticker, {
    currency: "USD",
    price,
    previousClose: quote.prevDay?.c,
    change: quote.todaysChange,
    changePercent: quote.todaysChangePerc,
    open: quote.day?.o,
    high: quote.day?.h,
    low: quote.day?.l,
    volume: quote.day?.v,
    asOf: updatedMs ? new Date(updatedMs).toISOString() : undefined
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
  // A 股：Finnhub/AlphaVantage/TwelveData 免费档基本不覆盖，主力是腾讯+新浪两个免费源；
  // 其余国际源仍保留在兜底链尾部（万一某天覆盖到了，白拿；拿不到就诚实报错，不额外处理）。
  const market = detectMarket(ticker);
  // 质量优先于竞速：配置 Massive 即代表已选择更高质量的美股源，先给它一个正常请求窗口；
  // 失败才降级到免费源竞速，不能让“谁快几十毫秒”决定事实来源。
  if (market === "US" && env("MASSIVE_API_KEY")) {
    try {
      return await fetchMassiveQuote(ticker);
    } catch { /* 进入下面现有的多源降级链 */ }
  }
  const fast =
    market === "US" ? [fetchFinnhub, fetchTwelveData]
    : market === "CN" ? [fetchTencentQuote, fetchSinaQuote]
    : [fetchTencentQuote, fetchFinnhub];
  const fallback =
    market === "US" ? [fetchEodhdQuote, fetchAlphaVantage, fetchYahooChart]
    : market === "CN" ? [fetchEodhdQuote, fetchTwelveData, fetchYahooChart]
    : [fetchEodhdQuote, fetchTwelveData, fetchAlphaVantage, fetchYahooChart];
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
    currency: marketCurrency(ticker),
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
  const symbol = toTencentSymbol(ticker); // 0700.HK → hk00700
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
