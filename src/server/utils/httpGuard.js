/**
 * httpGuard — E11 安全底座（U-0，PLAN v5 红线 19）。
 *
 * 两件事，都是零依赖纯逻辑：
 *
 * 1. 静态文件白名单 isAllowedStaticPath：
 *    旧行为是"项目根目录下任何可读文件都发"——本机 127.0.0.1 时代无所谓，
 *    公网暴露后 /.env（全部 API key）和 /luvio.db（整库）会被直接下载。
 *    改成显式白名单：前端真正需要的只有 index.html、src/app.js、src/ui/*.js、
 *    src/styles/*.css 和 /assets/**（图标/未来 PWA manifest）。名单外的 GET
 *    一律回 SPA 壳（index.html），跟不存在的路径同样待遇——不泄露"文件存在但被拒"。
 *
 * 2. 令牌桶限速 TokenBucket：
 *    /api/ask 一次 = LLM 调用 + 多路数据 API，≤10 人共享同一组 key，
 *    没有限速的话一个失控的标签页循环就能烧光当月配额。
 *    普通 API 与重型 API（LLM/解析类）分桶，按 key（IP 或未来的 user id）计数。
 *
 * 全部导出为可注入时钟的纯函数/类，无网络无 DB 即可单测（tests/phase-u0.mjs）。
 */

// ── 静态白名单 ────────────────────────────────────────────────

const EXACT_ALLOWED = new Set(["/", "/index.html"]);

/**
 * 是否允许作为静态文件发出（pathname 已 decodeURIComponent + normalize）。
 * @param {string} pathname
 */
export function isAllowedStaticPath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return false;
  if (pathname.includes("..") || pathname.includes("\0")) return false; // 纵深防御，上游已 normalize
  if (EXACT_ALLOWED.has(pathname)) return true;
  if (pathname === "/src/app.js") return true;
  // 两个前端模块直接复用纯函数 market.js；它不读 env/DB/服务端代码，必须显式放行。
  if (pathname === "/src/market.js") return true;
  // 前端模块与样式：只认这两个目录的对应扩展名（src/server/** 永不可达）
  if (/^\/src\/ui\/[\w.-]+\.js$/.test(pathname)) return true;
  if (/^\/src\/styles\/[\w.-]+\.css$/.test(pathname)) return true;
  // 图标 / 未来 PWA 资产（manifest + icons），只放静态资源扩展名
  if (/^\/assets\/[\w./-]+\.(png|jpg|jpeg|webp|svg|ico|json|webmanifest)$/.test(pathname)) return true;
  return false;
}

// ── 令牌桶限速 ────────────────────────────────────────────────

export class TokenBucket {
  /**
   * @param {{perMinute: number, burst?: number}} opts perMinute=0 表示禁用（全放行）
   */
  constructor({ perMinute, burst }) {
    this.perMinute = perMinute;
    this.capacity = burst ?? Math.max(1, Math.ceil(perMinute / 4));
    /** @type {Map<string, {tokens: number, lastRefill: number}>} */
    this.buckets = new Map();
  }

  /**
   * 该 key 此刻是否放行（放行则消耗一个令牌）。
   * @param {string} key IP 或 user id
   * @param {number} [nowMs] 可注入时钟（测试用）
   */
  allow(key, nowMs = Date.now()) {
    if (!this.perMinute) return true; // 0 = 禁用
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, lastRefill: nowMs };
      this.buckets.set(key, b);
    }
    const elapsedMin = (nowMs - b.lastRefill) / 60000;
    if (elapsedMin > 0) {
      b.tokens = Math.min(this.capacity, b.tokens + elapsedMin * this.perMinute);
      b.lastRefill = nowMs;
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** 清理长时间没动静的桶，防止 Map 无限膨胀（server 每小时调一次即可）。 */
  prune(nowMs = Date.now(), idleMs = 3600_000) {
    for (const [key, b] of this.buckets) {
      if (nowMs - b.lastRefill > idleMs) this.buckets.delete(key);
    }
  }
}

// ── 客户端标识 ────────────────────────────────────────────────

/**
 * 取限速用的客户端 key。生产在 Caddy 反代后面（LUVIO_TRUST_PROXY=1 才信
 * X-Forwarded-For 的第一跳），本机直连用 socket 地址。
 * @param {import("node:http").IncomingMessage} req
 */
export function clientKey(req) {
  if (process.env.LUVIO_TRUST_PROXY === "1") {
    const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (xff) return xff;
  }
  return req.socket?.remoteAddress || "unknown";
}

// ── server.js 用的现成实例（env 可调；LUVIO_RATE_LIMIT_DISABLED=1 全关） ──

const disabled = process.env.LUVIO_RATE_LIMIT_DISABLED === "1";
const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

/** 普通 API：读列表/状态类，默认 240/分钟。 */
export const generalBucket = new TokenBucket({ perMinute: disabled ? 0 : num("LUVIO_RATE_GENERAL_PER_MIN", 240), burst: 80 });
/** 重型 API（LLM/文档解析/一手管道触发）：默认 12/分钟。 */
export const heavyBucket = new TokenBucket({ perMinute: disabled ? 0 : num("LUVIO_RATE_HEAVY_PER_MIN", 12), burst: 6 });

/** 重型端点前缀（POST 才算重：GET /api/chat 不存在）。 */
const HEAVY_PREFIXES = ["/api/ask", "/api/chat", "/api/report/generate", "/api/parse-document", "/api/hk-financials/ingest", "/api/discover"];

/**
 * API 限速检查。放行返回 null，拒绝返回 {status, message}。
 * @param {import("node:http").IncomingMessage} req
 * @param {string} pathname
 */
export function rateLimitCheck(req, pathname) {
  const key = clientKey(req);
  const heavy = req.method === "POST" && HEAVY_PREFIXES.some((p) => pathname.startsWith(p));
  const ok = heavy ? heavyBucket.allow(key) : generalBucket.allow(key);
  if (ok) return null;
  return {
    status: 429,
    message: heavy ? "研究请求太频繁，请稍等一分钟再试" : "请求太频繁，请稍后再试"
  };
}
