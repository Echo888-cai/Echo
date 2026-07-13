/**
 * historicalValuation — F-5 历史估值分位（近似口径，US 先行，港股经 ADR 映射）。
 *
 * Finnhub `/stock/metric?metric=all` 的 series.annual.pe 是该公司逐年财年结束日的
 * trailing PE 快照（真实调用验证：AAPL 26 年、TCEHY 22 年）——不是逐日分布。用它算
 * "当前 PE 在历史分布里的百分位"是近似口径：比的是"当前 PE vs 历史每个财年末的 PE
 * 快照"，样本点是年度级别，不是日度级别。正文与面板必须显式标"近似口径"（PLAN.md 红线11）。
 * `market_snapshots` 表已经在每次行情快照落库时顺带存 pe/as_of（001_init.sql），会随时间
 * 自然积累成逐日分布——那是未来升级到精确口径的自沉淀数据源，这里不重复建设。
 *
 * 缓存的是历史序列本身（年度数据几乎不变，缓存收益最大）；当前 PE 与百分位不缓存——
 * 每次调用用调用方传入的实时 PE 现算，避免"缓存了24小时前的百分位"这种隐藏陈旧。
 *
 * 样本不足（<5 年）诚实返回 missing，不用两三个点硬算百分位。亏损年份（PE<=0）不计入
 * 分布——跟当前正 PE 比较没有意义。
 */
import { adrOrBareSymbol, detectMarket } from "../../market.js";
import { fetchJson as requestJson } from "../utils/http.js";
import { getHistoricalValuationRow, upsertHistoricalValuationSeries } from "../repositories/historicalValuationRepository.js";

const TTL_MS = 24 * 60 * 60 * 1000;
const MIN_SAMPLE_YEARS = 5;
const FETCH_TIMEOUT_MS = 8000;

function env(name) {
  return process.env[name] || "";
}

const fetchJson = (url, timeoutMs) => requestJson(url, {
  timeoutMs,
  userAgent: "EchoResearch/1.0 historical valuation"
});

/** Finnhub 年度 PE 序列（新→旧），过滤掉亏损年份（PE<=0）和非有限值。 */
async function fetchAnnualPeSeries(symbol) {
  const apiKey = env("FINNHUB_API_KEY");
  if (!apiKey) throw new Error("missing FINNHUB_API_KEY");
  const json = await fetchJson(
    `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey}`,
    FETCH_TIMEOUT_MS
  );
  const series = json?.series?.annual?.pe;
  if (!Array.isArray(series)) return [];
  return series
    .filter((p) => p && Number.isFinite(p.v) && p.v > 0)
    .map((p) => ({ period: p.period, value: p.v }));
}

function rowAgeMs(row) {
  const fetchedAt = Date.parse(`${row.fetched_at}Z`);
  return Number.isFinite(fetchedAt) ? Date.now() - fetchedAt : Infinity;
}

function safeParseJson(json, fallback) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

/**
 * 拉取（或读缓存）该 ticker 的历史年度 PE 序列。纯粹是网络+缓存部分，不碰"当前 PE"——
 * 百分位计算交给 computeHistoricalValuationPercentile，方便调用方把这一步跟
 * market/financials 的并发拉取放在同一批 Promise.allSettled 里。
 * @returns {Promise<{series: Array<{period:string, value:number}>, providerStatus:string, detail:string|null, stale:boolean}>}
 */
export async function getHistoricalValuationSeries(ticker) {
  const t = String(ticker || "").toUpperCase();
  const row = getHistoricalValuationRow(t);
  if (row && rowAgeMs(row) < TTL_MS) {
    return { series: safeParseJson(row.series_json, []), providerStatus: row.provider_status, detail: row.detail, stale: false };
  }

  const symbol = adrOrBareSymbol(t);
  if (!symbol) {
    const marketName = detectMarket(t) === "CN" ? "A 股" : "港股";
    const result = { series: [], providerStatus: "missing", detail: `${marketName}无美股 ADR 映射，Finnhub 免费档无法核到历史估值序列` };
    upsertHistoricalValuationSeries({ ticker: t, ...result });
    return { ...result, stale: false };
  }

  try {
    const series = await fetchAnnualPeSeries(symbol);
    const result = series.length >= MIN_SAMPLE_YEARS
      ? { series, providerStatus: "ok", detail: null }
      : { series, providerStatus: "missing", detail: `历史年度 PE 样本仅 ${series.length} 年（需要 ≥${MIN_SAMPLE_YEARS} 年），暂不生成分位` };
    upsertHistoricalValuationSeries({ ticker: t, ...result });
    return { ...result, stale: false };
  } catch (error) {
    if (row) return { series: safeParseJson(row.series_json, []), providerStatus: row.provider_status, detail: row.detail, stale: true }; // 兜底：旧数据总比什么都没有强
    const detail = error?.message || "历史估值序列请求失败";
    upsertHistoricalValuationSeries({ ticker: t, series: [], providerStatus: "error", detail });
    return { series: [], providerStatus: "error", detail, stale: false };
  }
}
