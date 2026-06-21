import assert from "node:assert/strict";
import {
  companies,
  companyByTicker,
  findCompany,
  normalizeTicker
} from "../src/data.js";
import { PROMPT_VERSION, PROMPTS, buildPromptContext, promptNames } from "../src/prompts.js";
import { marketSnapshotToMarkdown } from "../src/marketData.js";
import { newsSnapshotToMarkdown } from "../src/newsData.js";
import { beijingDate, anchorQueryToDate, hasRelativeTime } from "../src/server/utils/time.js";
import { buildEvidenceQueries } from "../src/server/services/intentClassifier.js";
import { fmpGet, fmpKeyPool, _resetFmpClient } from "../src/fmpClient.js";
import { parseUserContext } from "../src/server/services/userContext.js";
import { classifyNewsSeverity } from "../src/server/services/eventEngine.js";
import { upsertCompanyProfile, getCompanyProfile, deleteCompanyProfile } from "../src/server/repositories/companyProfiles.js";
import { upsertPosition, getPosition, deletePosition } from "../src/server/repositories/portfolio.js";

assert.equal(companies.length, 31, "seed data should include 31 HK companies");
assert.equal(PROMPT_VERSION, "luvio-prompts-v0.6");
assert.ok(promptNames().includes("首席研究助手"));
assert.ok(PROMPTS.risk.system.includes("挑战"));
// 研究纪律宪法注入 cio 与 chat 两条链路。
assert.ok(PROMPTS.cio.system.includes("概率优先"), "cio prompt should embed the research discipline");
assert.ok(PROMPTS.chat.system.includes("概率优先"), "chat prompt should embed the research discipline");

assert.equal(normalizeTicker("1316"), "1316.HK");
assert.equal(normalizeTicker("388"), "0388.HK");
assert.equal(findCompany("耐世特").ticker, "1316.HK");
assert.equal(findCompany("腾讯").ticker, "0700.HK");
assert.equal(findCompany("分析一下 1316.HK 耐世特").ticker, "1316.HK");
assert.equal(findCompany("腾讯现在贵不贵？").ticker, "0700.HK");
assert.equal(findCompany("地平线还有没有转机？").ticker, "9660.HK");
assert.equal(findCompany("联想怎么样？").ticker, "0992.HK");
assert.equal(findCompany("帮我对比比亚迪和吉利").ticker, "1211.HK");
assert.equal(companyByTicker("700")?.ticker, "0700.HK");

const nexteer = companyByTicker("1316.HK");
assert.match(buildPromptContext(nexteer, "分析耐世特", []), /1316.HK/);

assert.match(
  marketSnapshotToMarkdown({
    providerStatus: "ok",
    source: "Test",
    asOf: "2026-06-12T10:00:00+08:00",
    price: 10,
    currency: "HKD",
    change: 0.2,
    changePercent: 2,
    volume: 1000
  }),
  /实时行情来源：Test/
);
assert.match(marketSnapshotToMarkdown({ providerStatus: "missing" }), /尚未接入/);
assert.match(
  newsSnapshotToMarkdown({
    providerStatus: "ok",
    source: "Test News",
    asOf: "2026-06-12T10:00:00+08:00",
    sentiment: { label: "中性偏观察", positiveCount: 1, negativeCount: 1, neutralCount: 0 },
    articles: [{ title: "Alibaba tests new retail push", description: "Market watches execution risk.", publishedAt: "2026-06-12" }]
  }),
  /新闻与舆论来源：Test News/
);

// ── 时间锚点与查询改写 ──────────────────────────────────────────
assert.match(beijingDate(), /^\d{4}-\d{2}-\d{2}$/);
assert.equal(hasRelativeTime("今天怎么样"), true);
assert.equal(hasRelativeTime("基本面如何"), false);
assert.equal(anchorQueryToDate("AAPL news", "AAPL 基本面"), "AAPL news", "无相对时间不改写");
assert.ok(anchorQueryToDate("AAPL news", "今天 AAPL 怎么样").startsWith(beijingDate()), "相对时间问题改写为绝对日期");
const relQueries = buildEvidenceQueries({ company: { ticker: "AAPL", nameEn: "Apple", nameZh: "苹果" }, question: "今天苹果怎么样" });
assert.ok(relQueries.every((q) => q.startsWith(beijingDate())), "相对时间问题的所有查询都锚定日期");

// ── FMP 多 Key fallback / 缓存 / 冷却 ──────────────────────────────
await (async () => {
  const realFetch = globalThis.fetch;
  const prevKeys = process.env.FMP_API_KEYS;
  const prevKey = process.env.FMP_API_KEY;
  process.env.FMP_API_KEYS = "KEY_BAD,KEY_GOOD";
  delete process.env.FMP_API_KEY;
  let calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const key = new URL(url).searchParams.get("apikey");
    if (key === "KEY_BAD") return { ok: false, status: 401, text: async () => "unauthorized" };
    return { ok: true, status: 200, text: async () => JSON.stringify([{ key }]) };
  };
  try {
    assert.deepEqual(fmpKeyPool(), ["KEY_BAD", "KEY_GOOD"]);
    _resetFmpClient();
    let r = await fmpGet("/stable/profile", { symbol: "AAPL" });
    assert.equal(r[0].key, "KEY_GOOD", "401 应自动 fallback 到下一个 Key");
    assert.equal(calls.length, 2);
    calls = [];
    await fmpGet("/stable/profile", { symbol: "AAPL" });
    assert.equal(calls.length, 0, "同请求应命中缓存");
    calls = [];
    await fmpGet("/stable/profile", { symbol: "MSFT" });
    assert.equal(calls.length, 1, "被拒 Key 冷却后不再重试");
  } finally {
    globalThis.fetch = realFetch;
    _resetFmpClient();
    if (prevKeys === undefined) delete process.env.FMP_API_KEYS; else process.env.FMP_API_KEYS = prevKeys;
    if (prevKey === undefined) delete process.env.FMP_API_KEY; else process.env.FMP_API_KEY = prevKey;
  }
})();

// ── P2.1 公司画像：建档 + 部分更新保留 ────────────────────────────
{
  const T = "SMOKEPF.US";
  deleteCompanyProfile(T);
  upsertCompanyProfile(T, { companyName: "冒烟", thesis: "现金流稳", researchStatus: "watch", confidence: "中", event: { date: "2026-06-22", summary: "建档" } });
  let p = getCompanyProfile(T);
  assert.equal(p.thesis, "现金流稳");
  assert.equal(p.events.length, 1);
  upsertCompanyProfile(T, { confidence: "低" }); // 部分更新
  p = getCompanyProfile(T);
  assert.equal(p.confidence, "低");
  assert.equal(p.thesis, "现金流稳", "部分更新应保留 thesis");
  deleteCompanyProfile(T);
}

// ── P3.1 事件引擎：新闻分级 ────────────────────────────────────────
assert.equal(classifyNewsSeverity({ title: "ROSEN LAW Reminds Investors" }), "drop", "律所广告→drop");
assert.equal(classifyNewsSeverity({ title: "Company faces SEC investigation" }), "high", "SEC调查→high");
assert.equal(classifyNewsSeverity({ title: "公司发布新配色" }), "low", "普通新闻→low");

// ── P3.2 持仓：止损/止盈解析 + 记账部分更新 ──────────────────────
{
  const c = parseUserContext("成本 4.9，持有 3000 股，止损 4.2，止盈 6.5");
  assert.equal(c.stopLoss, "4.2");
  assert.equal(c.takeProfit, "6.5");
  const T = "SMOKEPOS.US";
  deletePosition(T);
  upsertPosition(T, { companyName: "冒烟", shares: 3000, avgCost: 4.9, stopLoss: 4.2 });
  upsertPosition(T, { stopLoss: 4.0 });
  const p = getPosition(T);
  assert.equal(p.stopLoss, 4.0);
  assert.equal(p.avgCost, 4.9, "部分更新应保留成本");
  deletePosition(T);
}

console.log("Smoke tests passed.");
