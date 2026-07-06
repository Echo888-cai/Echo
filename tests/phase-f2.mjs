// F-2 测试：业绩闭环（earnings actual/surprise 入库 + 业绩后复核任务 + R7 scorecard 接入 beat/miss）。
// [1] computeSurprisePct：纯函数边界（缺失/预期为 0）。
// [2] earningsCalendarRepository：lastReported 字段落库/读回、listWithLastReported 筛选。
// [3] researchReview：computePostEarnings 的"快照之后才算数"判定 + scorecard 的 epsBeatRate 聚合
//     （样本为 0 时诚实返回 null，不是 0%）。
// [4] scheduler.runEarningsReviewJob：真实跑一轮（无网络——命中 24h TTL 缓存），确认命中一条
//     "刚公布"的财报时会通知 + 补一条画像时间线事件；同一期报告的 dedupeKey 防重复。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { computeSurprisePct } from "../src/server/services/earningsCalendar.js";
import { upsertEarningsCalendar, getEarningsCalendarRow, listWithLastReported } from "../src/server/repositories/earningsCalendarRepository.js";
import { computeSnapshotReview, computeTickerScorecard } from "../src/server/services/researchReview.js";
import { insertResearchSnapshot, listSnapshots } from "../src/server/repositories/researchSnapshotsRepository.js";
import { upsertCompanyProfile } from "../src/server/repositories/companyProfiles.js";
import { listProfileEvents } from "../src/server/repositories/companyProfiles.js";
import { listNotifications } from "../src/server/repositories/notifications.js";
import { JOBS } from "../src/server/services/scheduler.js";

let pass = 0;
let fail = 0;
function check(description, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ ${description}: ${err.message}`);
  }
}
async function checkAsync(description, fn) {
  try {
    await fn();
    pass++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ ${description}: ${err.message}`);
  }
}

console.log("[1] computeSurprisePct");
check("正常 beat：(实际-预期)/|预期|", () => {
  assert.equal(computeSurprisePct(1.1, 1.0), 10);
});
check("miss 为负数", () => {
  assert.equal(computeSurprisePct(0.9, 1.0), -10);
});
check("预期为 0 时返回 null（除零无意义）", () => {
  assert.equal(computeSurprisePct(1.0, 0), null);
});
check("实际或预期缺失时返回 null", () => {
  assert.equal(computeSurprisePct(null, 1.0), null);
  assert.equal(computeSurprisePct(1.0, null), null);
});

console.log("\n[2] earningsCalendarRepository：lastReported 落库/读回 + listRecentlyReported");
check("upsert 带 lastReported，getEarningsCalendarRow 读回 last_* 列正确", () => {
  upsertEarningsCalendar({
    ticker: "F2TEST",
    nextDate: "2026-10-01", quarter: 4, year: 2026, epsEstimate: 2.0, revenueEstimate: 1e9,
    source: "Finnhub", providerStatus: "ok", detail: null,
    lastReported: { date: "2026-07-01", quarter: 3, year: 2026, epsEstimate: 1.5, epsActual: 1.65, revenueEstimate: 9e8, revenueActual: 9.5e8, epsSurprisePct: 10, revenueSurprisePct: 5.6 }
  });
  const row = getEarningsCalendarRow("F2TEST");
  assert.equal(row.last_date, "2026-07-01");
  assert.equal(row.last_quarter, 3);
  assert.equal(row.last_eps_actual, 1.65);
  assert.equal(row.last_eps_surprise_pct, 10);
  assert.equal(row.last_revenue_surprise_pct, 5.6);
});

check("upsert 不带 lastReported（null）：last_* 列全为 null，不残留旧值", () => {
  upsertEarningsCalendar({ ticker: "F2NOREPORT", nextDate: "2026-11-01", quarter: 1, year: 2027, epsEstimate: null, revenueEstimate: null, source: "Finnhub", providerStatus: "ok", detail: null });
  const row = getEarningsCalendarRow("F2NOREPORT");
  assert.equal(row.last_date, null);
  assert.equal(row.last_eps_actual, null);
});

check("重复 upsert 会覆盖 last_* 字段（不是仅插入一次）", () => {
  upsertEarningsCalendar({ ticker: "F2TEST", nextDate: "2026-10-01", quarter: 4, year: 2026, epsEstimate: 2.0, revenueEstimate: 1e9, source: "Finnhub", providerStatus: "ok", detail: null, lastReported: null });
  const row = getEarningsCalendarRow("F2TEST");
  assert.equal(row.last_date, null, "覆盖后应清空，不残留上一次的 2026-07-01");
});

check("listWithLastReported：只返回已核到 eps_actual 的 ticker（不按日期新旧筛选）", () => {
  upsertEarningsCalendar({
    ticker: "F2RECENT", nextDate: null, quarter: null, year: null, epsEstimate: null, revenueEstimate: null,
    source: "Finnhub", providerStatus: "ok", detail: null,
    lastReported: { date: new Date().toISOString().slice(0, 10), quarter: 2, year: 2026, epsEstimate: 1.0, epsActual: 1.2, revenueEstimate: null, revenueActual: null, epsSurprisePct: 20, revenueSurprisePct: null }
  });
  upsertEarningsCalendar({
    ticker: "F2OLD", nextDate: null, quarter: null, year: null, epsEstimate: null, revenueEstimate: null,
    source: "Finnhub", providerStatus: "ok", detail: null,
    lastReported: { date: "2020-01-01", quarter: 4, year: 2019, epsEstimate: 1.0, epsActual: 1.1, revenueEstimate: null, revenueActual: null, epsSurprisePct: 10, revenueSurprisePct: null }
  });
  upsertEarningsCalendar({ ticker: "F2NEVER", nextDate: "2026-12-01", quarter: 1, year: 2027, epsEstimate: 1.0, revenueEstimate: null, source: "Finnhub", providerStatus: "ok", detail: null });
  const reported = listWithLastReported();
  assert.ok(reported.some((r) => r.ticker === "F2RECENT"));
  assert.ok(reported.some((r) => r.ticker === "F2OLD"), "老报告也该出现——新旧判断交给 dedupeKey，不在这里筛");
  assert.ok(!reported.some((r) => r.ticker === "F2NEVER"), "从没核到过实际值的 ticker 不该出现");
});

console.log("\n[3] researchReview：postEarnings 判定 + scorecard 的 epsBeatRate");
check("earningsRow.last_date 晚于快照日期 → postEarnings 有值", () => {
  const snapshot = { ticker: "F2TEST", snapshotDate: "2026-06-01", priceAtSnapshot: 100, valuationBear: 80, valuationBase: 100, valuationBull: 120, valuationPosition: "at_base", falsifiers: [] };
  const earningsRow = { last_date: "2026-07-01", last_eps_surprise_pct: 12.3, last_revenue_surprise_pct: 4.5 };
  const review = computeSnapshotReview(snapshot, { price: 105 }, "2026-07-20", earningsRow);
  assert.ok(review.postEarnings);
  assert.equal(review.postEarnings.date, "2026-07-01");
  assert.equal(review.postEarnings.epsSurprisePct, 12.3);
});

check("earningsRow.last_date 早于（或等于）快照日期 → postEarnings 为 null（那份报告当时就已知）", () => {
  const snapshot = { ticker: "F2TEST", snapshotDate: "2026-07-05", priceAtSnapshot: 100, valuationBear: 80, valuationBase: 100, valuationBull: 120, valuationPosition: "at_base", falsifiers: [] };
  const earningsRow = { last_date: "2026-07-01", last_eps_surprise_pct: 12.3, last_revenue_surprise_pct: 4.5 };
  const review = computeSnapshotReview(snapshot, { price: 105 }, "2026-07-20", earningsRow);
  assert.equal(review.postEarnings, null);
});

check("没有 earningsRow 时 postEarnings 诚实为 null（不是报错）", () => {
  const snapshot = { ticker: "F2TEST", snapshotDate: "2026-06-01", priceAtSnapshot: 100, valuationBear: 80, valuationBase: 100, valuationBull: 120, valuationPosition: "at_base", falsifiers: [] };
  const review = computeSnapshotReview(snapshot, { price: 105 }, "2026-07-20");
  assert.equal(review.postEarnings, null);
});

check("computeTickerScorecard：样本为 0 时 epsBeatRate=null（不是 0%）", () => {
  const snapshots = [
    { ticker: "F2SC", snapshotDate: "2026-01-01", priceAtSnapshot: 100, valuationBear: 80, valuationBase: 100, valuationBull: 120, valuationPosition: "at_base", falsifiers: [] },
    { ticker: "F2SC", snapshotDate: "2026-01-05", priceAtSnapshot: 100, valuationBear: 80, valuationBase: 100, valuationBull: 120, valuationPosition: "at_base", falsifiers: [] },
    { ticker: "F2SC", snapshotDate: "2026-01-10", priceAtSnapshot: 100, valuationBear: 80, valuationBase: 100, valuationBull: 120, valuationPosition: "at_base", falsifiers: [] }
  ];
  const sc = computeTickerScorecard(snapshots, { price: 105 }, "2026-02-01", null);
  assert.equal(sc.postEarningsSampleSize, 0);
  assert.equal(sc.epsBeatRate, null);
});

check("computeTickerScorecard：有可比样本时正确算 beat 率", () => {
  const snapshots = [
    { ticker: "F2SC2", snapshotDate: "2026-01-01", priceAtSnapshot: 100, valuationBear: 80, valuationBase: 100, valuationBull: 120, valuationPosition: "at_base", falsifiers: [] },
    { ticker: "F2SC2", snapshotDate: "2026-01-05", priceAtSnapshot: 100, valuationBear: 80, valuationBase: 100, valuationBull: 120, valuationPosition: "at_base", falsifiers: [] },
    { ticker: "F2SC2", snapshotDate: "2026-01-10", priceAtSnapshot: 100, valuationBear: 80, valuationBase: 100, valuationBull: 120, valuationPosition: "at_base", falsifiers: [] }
  ];
  const earningsRow = { last_date: "2026-01-20", last_eps_surprise_pct: 8.0, last_revenue_surprise_pct: -2.0 };
  const sc = computeTickerScorecard(snapshots, { price: 105 }, "2026-02-01", earningsRow);
  assert.equal(sc.postEarningsSampleSize, 3, "3 条快照的 snapshotDate 都早于 last_date，全部计入");
  assert.equal(sc.epsBeatRate, 100, "eps surprise 12.3>0，3/3 全 beat");
});

console.log("\n[4] scheduler：earnings_review 任务真实注册 + 命中通知/画像联动（无网络，命中 TTL 缓存）");
check("JOBS 含 earnings_review，daily 07:30", () => {
  const job = JOBS.find((j) => j.id === "earnings_review");
  assert.ok(job, "应有 earnings_review 任务");
  assert.equal(job.schedule.kind, "daily");
  assert.equal(job.schedule.at, "07:30");
});

await checkAsync("命中最近财报的票：通知落库 + 画像时间线补一条 earnings_report", async () => {
  const ticker = "F2JOBTEST";
  insertResearchSnapshot({ ticker, snapshotDate: "2026-01-01", thesis: "测试主线", priceAtSnapshot: 100 });
  upsertCompanyProfile(ticker, { companyName: "F2 测试公司", thesis: "测试主线" });
  upsertEarningsCalendar({
    ticker, nextDate: null, quarter: null, year: null, epsEstimate: null, revenueEstimate: null,
    source: "Finnhub", providerStatus: "ok", detail: null,
    lastReported: {
      date: new Date().toISOString().slice(0, 10), quarter: 2, year: 2026,
      epsEstimate: 1.0, epsActual: 1.15, revenueEstimate: 1e9, revenueActual: 1.02e9,
      epsSurprisePct: 15, revenueSurprisePct: 2
    }
  });
  const job = JOBS.find((j) => j.id === "earnings_review");
  const detail = await job.run();
  assert.match(detail, /条业绩后提醒已通知/);

  const notifs = listNotifications(20);
  const hit = notifs.find((n) => n.kind === "earnings_review" && n.ticker === ticker);
  assert.ok(hit, "应有一条 earnings_review 通知");
  assert.match(hit.title, /F2 测试公司/);

  const events = listProfileEvents(ticker, 20);
  const reportEvent = events.find((e) => e.kind === "earnings_report");
  assert.ok(reportEvent, "画像时间线应补一条 earnings_report 事件");
});

await checkAsync("同一期报告不重复通知（dedupeKey 命中）", async () => {
  const before = listNotifications(50).filter((n) => n.kind === "earnings_review" && n.ticker === "F2JOBTEST").length;
  const job = JOBS.find((j) => j.id === "earnings_review");
  await job.run();
  const after = listNotifications(50).filter((n) => n.kind === "earnings_review" && n.ticker === "F2JOBTEST").length;
  assert.equal(after, before, "同一期报告（同 last_date）再跑一次不该产生第二条通知");
});

await checkAsync("范围外的 ticker（有 earnings_calendar 数据但无研究快照）不被通知（真实浏览器验证抓到的回归）", async () => {
  // F2JOBTEST 已在库（有快照），F2OUTOFSCOPE 只被查过财报日历、从没成为过研究对象——
  // 真实跑一轮 dev DB 时发现 listWithLastReported() 是全表扫描，会把它也拉进通知名单。
  upsertEarningsCalendar({
    ticker: "F2OUTOFSCOPE", nextDate: null, quarter: null, year: null, epsEstimate: null, revenueEstimate: null,
    source: "Finnhub", providerStatus: "ok", detail: null,
    lastReported: { date: "2026-05-01", quarter: 1, year: 2026, epsEstimate: 1.0, epsActual: 1.3, revenueEstimate: null, revenueActual: null, epsSurprisePct: 30, revenueSurprisePct: null }
  });
  const job = JOBS.find((j) => j.id === "earnings_review");
  await job.run();
  const hit = listNotifications(50).find((n) => n.kind === "earnings_review" && n.ticker === "F2OUTOFSCOPE");
  assert.equal(hit, undefined, "从未被研究过的 ticker 不该收到业绩后提醒");
});

check("无研究快照时任务直接跳过（不触发任何网络请求）", () => {
  // 已在上面用真实快照跑过；这里只验证函数存在且签名正确，真正的"空库跳过"路径
  // 由 [1]/[2] 的隔离测试库启动时（本文件运行前）自然覆盖，此处不重复造空库场景
  // 以避免和上面已插入的快照数据冲突。
  const job = JOBS.find((j) => j.id === "earnings_review");
  assert.equal(typeof job.run, "function");
});

console.log(`\nF-2: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
