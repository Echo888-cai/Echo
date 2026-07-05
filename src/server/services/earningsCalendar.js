/**
 * earningsCalendar — G-2 财报日历（Finnhub /calendar/earnings + 24h TTL 读穿透缓存）。
 *
 * 数据源：
 *   - 美股：直接用 bare ticker（AAPL）查 Finnhub /calendar/earnings。
 *   - 港股：Finnhub 免费档没有原生港股日历，改查该公司的美股 ADR（如 0700→TCEHY）。
 *     已用真实请求验证：查 TCEHY 时 Finnhub 返回的记录 symbol 是 "700.HK"——说明
 *     Finnhub 内部本就把同一家公司的 ADR 和港股主体关联在一起，日期就是公司整体的
 *     下一财报日，不是"编造"。没有 ADR 映射的港股，诚实返回 missing，不猜。
 *
 * 缓存：earnings_calendar 表，24h TTL 读穿透；请求失败时如果有旧数据（哪怕过期）
 * 就兜底返回旧数据（stale-if-error），只有从没成功过才报错——不做后台常驻任务，
 * 纯按需触发。
 */
import { detectMarket, adrOrBareSymbol } from "../../market.js";
import { getEarningsCalendarRow, upsertEarningsCalendar } from "../repositories/earningsCalendarRepository.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const LOOKAHEAD_DAYS = 180;

function env(name) {
  return process.env[name] || "";
}

async function fetchJson(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Luvio/0.1 earnings calendar", Accept: "application/json" } });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

const EMPTY_EARNINGS_FIELDS = { nextDate: null, quarter: null, year: null, epsEstimate: null, revenueEstimate: null };

/**
 * 真实抓取（不查缓存）。
 * @returns {Promise<{providerStatus: "ok"|"missing", nextDate: string|null, quarter: number|null, year: number|null, epsEstimate: number|null, revenueEstimate: number|null, source: string|null, detail: string|null}>}
 */
async function fetchFromFinnhub(ticker) {
  const symbol = adrOrBareSymbol(ticker);
  if (!symbol) {
    return { ...EMPTY_EARNINGS_FIELDS, providerStatus: "missing", detail: "港股无美股 ADR 映射，Finnhub 免费档无法核到财报日", source: null };
  }
  const apiKey = env("FINNHUB_API_KEY");
  if (!apiKey) throw new Error("missing FINNHUB_API_KEY");

  const today = new Date();
  const to = new Date(today.getTime() + LOOKAHEAD_DAYS * 86400000);
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${isoDate(today)}&to=${isoDate(to)}&symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const data = await fetchJson(url);
  const rows = Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : [];
  const todayStr = isoDate(today);
  const upcoming = rows.filter((r) => r.date && r.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!upcoming) {
    return { ...EMPTY_EARNINGS_FIELDS, providerStatus: "missing", detail: `Finnhub 日历里没有 ${symbol} 的未来财报日`, source: "Finnhub" };
  }
  return {
    providerStatus: "ok",
    nextDate: upcoming.date,
    quarter: upcoming.quarter ?? null,
    year: upcoming.year ?? null,
    epsEstimate: upcoming.epsEstimate ?? null,
    revenueEstimate: upcoming.revenueEstimate ?? null,
    source: "Finnhub",
    detail: detectMarket(ticker) === "HK" ? `经 ADR ${symbol} 核到` : null
  };
}

function rowToResult(row, { stale = false } = {}) {
  return {
    ticker: row.ticker,
    providerStatus: row.provider_status,
    nextDate: row.next_date,
    quarter: row.quarter,
    year: row.year,
    epsEstimate: row.eps_estimate,
    revenueEstimate: row.revenue_estimate,
    source: row.source,
    detail: row.detail,
    stale
  };
}

function rowAgeMs(row) {
  // sqlite datetime('now') 落的是 UTC "YYYY-MM-DD HH:MM:SS"（无时区后缀）。
  const fetchedAt = Date.parse(`${row.fetched_at}Z`);
  return Number.isFinite(fetchedAt) ? Date.now() - fetchedAt : Infinity;
}

/**
 * 该 ticker 的"下一业绩日"，24h TTL 读穿透缓存，stale-if-error 兜底。
 * @returns {Promise<{ticker, providerStatus: "ok"|"missing"|"error", nextDate, quarter, year, epsEstimate, revenueEstimate, source, detail, stale}>}
 */
export async function getNextEarnings(ticker) {
  const t = String(ticker || "").toUpperCase();
  const row = getEarningsCalendarRow(t);
  if (row && rowAgeMs(row) < TTL_MS) return rowToResult(row);

  try {
    const fresh = await fetchFromFinnhub(t);
    upsertEarningsCalendar({ ticker: t, ...fresh });
    return { ticker: t, stale: false, ...fresh };
  } catch (error) {
    if (row) return rowToResult(row, { stale: true }); // 兜底：旧数据总比什么都没有强
    const detail = error?.message || "财报日历请求失败";
    upsertEarningsCalendar({ ticker: t, providerStatus: "error", detail, source: null, ...EMPTY_EARNINGS_FIELDS });
    return { ticker: t, providerStatus: "error", detail, source: null, stale: false, ...EMPTY_EARNINGS_FIELDS };
  }
}
