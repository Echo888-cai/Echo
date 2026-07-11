/**
 * fmpClient — Financial Modeling Prep 访问层，带多 Key fallback 与分级 TTL 缓存。
 *
 * 对标顶级投研系统的数据层工程：
 * - 多 Key：FMP_API_KEY（单个）+ FMP_API_KEYS（逗号分隔多个）合并去重
 * - 自动 fallback：某 Key 命中 401/402/403/429 时，标记冷却并切换到下一个 Key
 * - 分级 TTL 缓存：行情 5min / 财报 6h / profile 24h / 评级 3h / 分红 12h
 *   缓存键用 path+params（不含 Key），同一请求多 Key 复用同一份缓存。
 */

// 分级 TTL（毫秒）—— 数据越稳定，缓存越久。
export const FMP_TTL = {
  fast: 5 * 60 * 1000,
  estimates: 3 * 60 * 60 * 1000,
  financials: 6 * 60 * 60 * 1000,
  dividends: 12 * 60 * 60 * 1000,
  profile: 24 * 60 * 60 * 1000
};

const AUTH_COOLDOWN_MS = 24 * 60 * 60 * 1000; // Key 被拒：冷却一天
const QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 配额超限：冷却 6 小时

const BASE_URL = "https://financialmodelingprep.com";

const cache = new Map(); // cacheKey -> { expiresAt, value }
const keyCooldownUntil = new Map(); // key -> timestamp

/** 读取 Key 池：FMP_API_KEY + FMP_API_KEYS（逗号分隔），去重去空。 */
export function fmpKeyPool() {
  const raw = [
    process.env.FMP_API_KEY || "",
    ...String(process.env.FMP_API_KEYS || "").split(",")
  ];
  const seen = new Set();
  const keys = [];
  for (const item of raw) {
    const key = String(item).trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/** 当前可用（未在冷却中）的 Key，按池子顺序。 */
function availableKeys(now = Date.now()) {
  return fmpKeyPool().filter((key) => (keyCooldownUntil.get(key) || 0) <= now);
}

// "这个端点要更高订阅档"的特征（FMP 免费档把财报三表等划成 premium/special endpoint）。
// 命中说明只是该端点不可用，不是 Key 限额——绝不能因此把整个 Key 冷却掉，否则会连累
// quote / profile / search 等还能正常用的免费端点（这正是"一查就全线不可用"的根因）。
const PREMIUM_GATE_RE = /premium|special endpoint|exclusive endpoint|not available under your current subscription|upgrade your plan|legacy endpoint/i;

/**
 * 把 HTTP 状态 + 响应体映射到错误类型：
 *   "endpoint_gated" 端点需更高套餐 → 本端点失败但不冷却 Key
 *   "auth"           Key 无效/被拒   → 冷却 Key 一天
 *   "quota"          限额/频率超限   → 冷却 Key 数小时
 *   null             非 Key 问题
 */
function keyErrorKind(status, text = "") {
  if (status === 402) return PREMIUM_GATE_RE.test(text) ? "endpoint_gated" : "quota";
  if (status === 401 || status === 403) return PREMIUM_GATE_RE.test(text) ? "endpoint_gated" : "auth";
  if (status === 429) return "quota";
  return null;
}

async function rawFetch(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "EchoResearch/1.0 fmp client", Accept: "application/json" }
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET 一个 FMP stable 端点。
 * @param {string} path   形如 "/stable/profile"
 * @param {object} params 查询参数（不含 apikey）
 * @param {object} opts   { ttl, timeoutMs }
 * @returns 解析后的 JSON
 */
export async function fmpGet(path, params = {}, { ttl = FMP_TTL.fast, timeoutMs = 8000 } = {}) {
  const search = new URLSearchParams(params);
  const cacheKey = `${path}?${search.toString()}`;

  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.value;

  const keys = availableKeys(now);
  if (!keys.length) {
    // 没有可用 Key：要么没配置，要么全在冷却。把过期缓存兜底返回，否则报错。
    if (hit) return hit.value;
    throw new Error(fmpKeyPool().length ? "FMP 所有 Key 均在冷却中" : "missing FMP_API_KEY");
  }

  let lastError = "";
  for (const key of keys) {
    const url = `${BASE_URL}${path}?${search.toString()}&apikey=${key}`;
    let result;
    try {
      result = await rawFetch(url, timeoutMs);
    } catch (err) {
      lastError = err?.message || "请求失败";
      continue; // 网络错误/超时：换下一个 Key 再试
    }

    const kind = keyErrorKind(result.status, result.text);
    if (kind === "endpoint_gated") {
      // 端点需更高订阅档：所有 Key 都一样拿不到，没必要换 Key，更不能冷却 Key
      // （否则连累其它免费端点）。直接抛，让调用方走下一个数据源（如 Finnhub）。
      throw new Error(`FMP 端点需更高订阅档（${result.status}）：${path}`);
    }
    if (kind) {
      keyCooldownUntil.set(key, now + (kind === "auth" ? AUTH_COOLDOWN_MS : QUOTA_COOLDOWN_MS));
      lastError = `${result.status} ${result.text.slice(0, 120)}`;
      continue; // Key 被拒/超限：冷却并换 Key
    }

    if (!result.ok) {
      // 非 Key 类错误（如 404/5xx）：不切 Key，直接抛。
      throw new Error(`${result.status} ${result.text.slice(0, 160)}`);
    }

    let value;
    try {
      value = JSON.parse(result.text);
    } catch {
      throw new Error("FMP 返回非 JSON");
    }
    cache.set(cacheKey, { expiresAt: now + ttl, value });
    return value;
  }

  // 所有 Key 都失败：有过期缓存就兜底，否则抛最后一次错误。
  if (hit) return hit.value;
  throw new Error(`FMP 请求失败（已尝试 ${keys.length} 个 Key）：${lastError}`);
}

/** 测试/诊断用：清空内存缓存与 Key 冷却状态。 */
export function _resetFmpClient() {
  cache.clear();
  keyCooldownUntil.clear();
}
