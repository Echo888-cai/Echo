// U-0（E11 安全底座）：静态白名单 + 令牌桶限速（PLAN v5 红线 19）。
// 纯函数测试，无网络无 DB。
import assert from "node:assert/strict";
import { isAllowedStaticPath, TokenBucket } from "../src/server/utils/httpGuard.js";

// ── 静态白名单：放行前端真正需要的 ─────────────────────────────
assert.ok(isAllowedStaticPath("/"), "根路径（SPA 壳）应放行");
assert.ok(isAllowedStaticPath("/index.html"));
assert.ok(isAllowedStaticPath("/src/app.js"));
assert.ok(isAllowedStaticPath("/src/market.js"), "前端 format/watch 直接依赖的纯函数模块必须放行");
assert.ok(isAllowedStaticPath("/packages/domain/src/companyIdentity.js"), "旧 SPA 只放行共用的证券身份纯函数");
assert.ok(isAllowedStaticPath("/src/ui/research.js"));
assert.ok(isAllowedStaticPath("/src/ui/api.js"));
assert.ok(isAllowedStaticPath("/src/styles/00-foundation.css"));
assert.ok(isAllowedStaticPath("/src/styles/08-portfolio.css"));
assert.ok(isAllowedStaticPath("/assets/icon-192.png"), "未来 PWA 图标目录应放行");
assert.ok(isAllowedStaticPath("/assets/manifest.webmanifest"));

// ── 静态白名单：挡住会泄密/泄源的（这就是 E11 要修的洞） ────────
assert.ok(!isAllowedStaticPath("/.env"), ".env 含全部 API key，绝不可发");
assert.ok(!isAllowedStaticPath("/echo.db"), "SQLite 整库绝不可发");
assert.ok(!isAllowedStaticPath("/echo.db-wal"));
assert.ok(!isAllowedStaticPath("/server.js"));
assert.ok(!isAllowedStaticPath("/package.json"));
assert.ok(!isAllowedStaticPath("/packages/domain/package.json"), "只放行精确领域模块，不开放 packages 目录");
assert.ok(!isAllowedStaticPath("/docs/PLAN.md"));
assert.ok(!isAllowedStaticPath("/src/server/services/factGuard.js"), "服务端源码不可达");
assert.ok(!isAllowedStaticPath("/src/db/migrations/001_init.sql"));
assert.ok(!isAllowedStaticPath("/scripts/seed-db.js"));
assert.ok(!isAllowedStaticPath("/src/data/cnStocks.js"), "src 下白名单目录以外一律拒");
assert.ok(!isAllowedStaticPath("/tests/smoke.mjs"));
// 纵深防御：穿越与畸形输入
assert.ok(!isAllowedStaticPath("/src/ui/../../.env"));
assert.ok(!isAllowedStaticPath("/src/ui/x\0.js"));
assert.ok(!isAllowedStaticPath("src/ui/api.js"), "必须以 / 开头");
assert.ok(!isAllowedStaticPath("/src/ui/sub/dir.js"), "ui 目录不放行子目录（当前没有）");
assert.ok(!isAllowedStaticPath("/assets/evil.js"), "assets 只放静态资源扩展名");

// ── 令牌桶：容量、消耗、按时间回填、按 key 隔离 ─────────────────
const bucket = new TokenBucket({ perMinute: 60, burst: 3 });
const t0 = 1_000_000;
assert.ok(bucket.allow("ip-a", t0));
assert.ok(bucket.allow("ip-a", t0));
assert.ok(bucket.allow("ip-a", t0));
assert.ok(!bucket.allow("ip-a", t0), "burst=3 的第 4 次同刻请求应被拒");
assert.ok(bucket.allow("ip-b", t0), "不同 key 互不影响");
// 60/min = 1/s：1 秒后回填 1 个令牌
assert.ok(bucket.allow("ip-a", t0 + 1000), "1 秒后应回填出 1 个令牌");
assert.ok(!bucket.allow("ip-a", t0 + 1000), "回填的那个已被消耗");
// 回填封顶在 burst，不无限累积
assert.ok(bucket.allow("ip-a", t0 + 3600_000));
assert.ok(bucket.allow("ip-a", t0 + 3600_000));
assert.ok(bucket.allow("ip-a", t0 + 3600_000));
assert.ok(!bucket.allow("ip-a", t0 + 3600_000), "闲置一小时也只回到 burst 上限");

// perMinute=0 = 禁用（测试/本机模式全放行）
const off = new TokenBucket({ perMinute: 0 });
for (let i = 0; i < 100; i++) assert.ok(off.allow("any", t0));

// prune 清理闲置 key
bucket.prune(t0 + 3600_000 + 3600_001);
assert.equal(bucket.buckets.size, 0, "闲置超时的桶应被清理");

console.log("phase-u0 ✓ 静态白名单 + 令牌桶限速（E11 安全底座）");
