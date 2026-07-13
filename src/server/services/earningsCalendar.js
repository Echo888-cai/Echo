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
 *
 * F-2 业绩闭环：`lastReported`（EPS 实际 vs 预期，含 surprise%）随 nextDate 一起持久化到
 * 同一行，供 scheduler 的业绩后复核任务与 R7 记分卡使用。
 *
 * 数据源修正（真实调用实测发现，2026-07-06）：最初设计假设 `/calendar/earnings` 把
 * `from` 往回推就能拿到"已报告"的实际值——真实请求验证这个假设是错的：Finnhub 免费档
 * 按 symbol 查询时，`/calendar/earnings` 只返回未来的排期条目（`epsActual`/`revenueActual`
 * 恒为 null），不管 `from` 设多早。真正带实际值的是专门的 `/stock/earnings?symbol=` 端点
 * （返回近几期 `estimate`/`actual`/`surprisePercent`），但**只有 EPS，没有营收实际值**——
 * 免费档没有营收 surprise 的数据源，诚实留空（revenueActual/revenueEstimate/
 * revenueSurprisePct 恒为 null），不拿"下一期的营收预期"顶替"上一期的营收实际"造假数据。
 * `last_date` 存的是该季度的**财季结束日**（fiscal period end），不是财报公告日
 * （免费档没有后者）——展示"哪一期"用它没问题，但不能拿它做"公告后 N 天"的精确计时；
 * 触发"要不要提醒"改用季度归属（year+quarter）判断是否是新一期，不依赖日期窗口。
 */
import { detectMarket, adrOrBareSymbol } from "../../market.js";
import { getEarningsCalendarRow, upsertEarningsCalendar } from "../repositories/earningsCalendarRepository.js";
import { fetchJson as requestJson } from "../utils/http.js";
import { computeSurprisePctExact } from "./financeKernel.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const LOOKAHEAD_DAYS = 180;

/**
 * 该 symbol 最近一期"已经有实际值"的报告（EPS only，见模块顶部说明）。
 * 不假设 Finnhub 返回顺序恒定（虽然实测是按时间倒序），按 period 防御性排序取最新。
 */
async function fetchLastReportedEarnings(symbol, apiKey) {
  const url = `https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
  const rows = await fetchJson(url);
  const withActual = (Array.isArray(rows) ? rows : [])
    .filter((r) => r.actual != null)
    .sort((a, b) => String(b.period || "").localeCompare(String(a.period || "")));
  const r = withActual[0];
  if (!r) return null;
  return {
    date: r.period ?? null,
    quarter: r.quarter ?? null,
    year: r.year ?? null,
    epsEstimate: r.estimate ?? null,
    epsActual: r.actual ?? null,
    revenueEstimate: null,
    revenueActual: null,
    epsSurprisePct: r.surprisePercent != null ? Math.round(r.surprisePercent * 10) / 10 : computeSurprisePctExact(r.actual, r.estimate),
    revenueSurprisePct: null
  };
}

function env(name) {
  return process.env[name] || "";
}

const fetchJson = (url, timeoutMs = 6000) => requestJson(url, {
  timeoutMs,
  userAgent: "EchoResearch/1.0 earnings calendar"
});

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

const EMPTY_EARNINGS_FIELDS = { nextDate: null, quarter: null, year: null, epsEstimate: null, revenueEstimate: null };

/**
 * @typedef {{date: string, quarter: number|null, year: number|null, epsEstimate: number|null,
 *   epsActual: number|null, revenueEstimate: number|null, revenueActual: number|null,
 *   epsSurprisePct: number|null, revenueSurprisePct: number|null}} LastReportedEarnings
 */

/**
 * 真实抓取（不查缓存）。
 * @returns {Promise<{providerStatus: "ok"|"missing", nextDate: string|null, quarter: number|null, year: number|null, epsEstimate: number|null, revenueEstimate: number|null, source: string|null, detail: string|null, lastReported: LastReportedEarnings|null}>}
 */
async function fetchFromFinnhub(ticker) {
  const symbol = adrOrBareSymbol(ticker);
  if (!symbol) {
    const marketName = detectMarket(ticker) === "CN" ? "A 股" : "港股";
    return { ...EMPTY_EARNINGS_FIELDS, lastReported: null, providerStatus: "missing", detail: `${marketName}无美股 ADR 映射，Finnhub 免费档无法核到财报日`, source: null };
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
  // 独立请求，失败不该拖垮"下一业绩日"这条更基础的信息——F-2 是加分项，不是必需项。
  const lastReported = await fetchLastReportedEarnings(symbol, apiKey).catch(() => null);
  if (!upcoming) {
    return { ...EMPTY_EARNINGS_FIELDS, lastReported, providerStatus: "missing", detail: `Finnhub 日历里没有 ${symbol} 的未来财报日`, source: "Finnhub" };
  }
  return {
    providerStatus: "ok",
    nextDate: upcoming.date,
    quarter: upcoming.quarter ?? null,
    year: upcoming.year ?? null,
    epsEstimate: upcoming.epsEstimate ?? null,
    revenueEstimate: upcoming.revenueEstimate ?? null,
    source: "Finnhub",
    detail: detectMarket(ticker) === "HK" ? `经 ADR ${symbol} 核到` : null,
    lastReported
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
    stale,
    lastReported: row.last_date ? {
      date: row.last_date,
      quarter: row.last_quarter,
      year: row.last_year,
      epsEstimate: row.last_eps_estimate,
      epsActual: row.last_eps_actual,
      revenueEstimate: row.last_revenue_estimate,
      revenueActual: row.last_revenue_actual,
      epsSurprisePct: row.last_eps_surprise_pct,
      revenueSurprisePct: row.last_revenue_surprise_pct
    } : null
  };
}

function rowAgeMs(row) {
  // sqlite datetime('now') 落的是 UTC "YYYY-MM-DD HH:MM:SS"（无时区后缀）。
  const fetchedAt = Date.parse(`${row.fetched_at}Z`);
  return Number.isFinite(fetchedAt) ? Date.now() - fetchedAt : Infinity;
}

/**
 * 该 ticker 的"下一业绩日"，24h TTL 读穿透缓存，stale-if-error 兜底。
 * @returns {Promise<{ticker, providerStatus: "ok"|"missing"|"error", nextDate, quarter, year, epsEstimate, revenueEstimate, source, detail, stale, lastReported: LastReportedEarnings|null}>}
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
    upsertEarningsCalendar({ ticker: t, providerStatus: "error", detail, source: null, lastReported: null, ...EMPTY_EARNINGS_FIELDS });
    return { ticker: t, providerStatus: "error", detail, source: null, lastReported: null, stale: false, ...EMPTY_EARNINGS_FIELDS };
  }
}
