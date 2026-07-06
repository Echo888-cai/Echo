// R7 测试：研究记分卡/自动复盘（快照落库 + 复盘计算 + 画像回写联动 + 复盘提醒任务）。
// [1] researchSnapshotsRepository：写入/读取/永不抛错/按 ticker 聚合。
// [2] researchReview：单条快照复盘（withinBand/towardBase/pctChange/证伪线状态）。
// [3] researchReview：记分卡样本量门槛（样本不足诚实降级，不硬凑百分比）。
// [4] companyPortrait.updatePortraitFromPanel：建档/判断变化时落快照，判断未变不落（不写流水账）。
// [5] scheduler review_reminder 任务：无快照跳过；快照够老才提醒；不够老不提醒。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import {
  insertResearchSnapshot, listSnapshots, listSnapshotTickers
} from "../src/server/repositories/researchSnapshotsRepository.js";
import {
  computeSnapshotReview, computeTickerScorecard, computeGlobalScorecard, MIN_MATURE_DAYS, MIN_MATURE_SAMPLES
} from "../src/server/services/researchReview.js";
import { updatePortraitFromPanel } from "../src/server/services/companyPortrait.js";
import { JOBS } from "../src/server/services/scheduler.js";
import { listNotifications } from "../src/server/repositories/notifications.js";

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
async function checkAsync(name, fn) {
  try { await fn(); pass += 1; console.log(`  ✓ ${name}`); }
  catch (err) { fail += 1; console.error(`  ✗ ${name}: ${err.message}`); }
}

console.log("[1] researchSnapshotsRepository");
{
  insertResearchSnapshot({
    ticker: "r7.test", snapshotDate: "2026-06-01", thesis: "测试主线 A",
    valuationPosition: "below_base", valuationBear: 80, valuationBase: 100, valuationBull: 120,
    valuationCurrency: "USD", priceAtSnapshot: 90, falsifiers: ["股价跌破 70 美元"], sessionId: "s_test1"
  });
  insertResearchSnapshot({
    ticker: "r7.test", snapshotDate: "2026-06-15", thesis: "测试主线 A 更新",
    valuationPosition: "above_base", valuationBear: 80, valuationBase: 100, valuationBull: 120,
    valuationCurrency: "USD", priceAtSnapshot: 110, falsifiers: [], sessionId: "s_test2"
  });
  const rows = listSnapshots("r7.test");
  check("写入两条、按 id 正序读回", rows.length === 2 && rows[0].snapshotDate === "2026-06-01" && rows[1].snapshotDate === "2026-06-15");
  check("falsifiers_json 正确反序列化成数组", Array.isArray(rows[0].falsifiers) && rows[0].falsifiers[0] === "股价跌破 70 美元");
  check("sessionId 原样透出", rows[0].sessionId === "s_test1");

  const tickers = listSnapshotTickers();
  const mine = tickers.find((t) => t.ticker === "R7.TEST");
  check("listSnapshotTickers：ticker 大写归一 + 计数正确", Boolean(mine) && mine.snapshotCount === 2);

  check("insertResearchSnapshot 永不抛错（缺 ticker 等异常输入）", () => {
    insertResearchSnapshot({ snapshotDate: "2026-01-01" });
    return true;
  }, "应静默失败而不是抛异常");
  assert.doesNotThrow(() => insertResearchSnapshot({ snapshotDate: "2026-01-01" }));
}

console.log("\n[2] computeSnapshotReview：单条快照复盘");
{
  const snapshot = {
    ticker: "R7.TEST", snapshotDate: "2026-06-01", thesis: "低于估值中枢",
    valuationPosition: "below_base", valuationBear: 80, valuationBase: 100, valuationBull: 120,
    valuationCurrency: "USD", priceAtSnapshot: 90, falsifiers: ["股价跌破 70 美元"], sessionId: "s1"
  };
  const asOf = "2026-06-15"; // 14 天后
  const r = computeSnapshotReview(snapshot, { price: 105 }, asOf);
  check("daysElapsed 计算正确", r.daysElapsed === 14);
  check("isMature：满 14 天判定为成熟", r.isMature === true);
  check("pctChange：(105-90)/90≈16.7%", Math.abs(r.pctChange - 16.7) < 0.2);
  check("withinBand：105 在 [80,120] 内 → true", r.withinBand === true);
  check("towardBase：below_base 且现价(105)>当时(90) → 向中枢靠拢", r.towardBase === true);
  check("falsifierStatus：跌破 70，现价 105 未越线", r.falsifierStatus[0].evaluable === true && r.falsifierStatus[0].breached === false);

  const rNotMature = computeSnapshotReview(snapshot, { price: 105 }, "2026-06-05"); // 4 天后
  check("未满 14 天：isMature 为 false", rNotMature.isMature === false);

  const rNoPrice = computeSnapshotReview(snapshot, { price: null }, asOf);
  check("现价缺失时 withinBand/towardBase/pctChange 都诚实返回 null", rNoPrice.withinBand === null && rNoPrice.towardBase === null && rNoPrice.pctChange === null);

  const breachSnapshot = { ...snapshot, falsifiers: ["股价跌破 70 美元"] };
  const rBreached = computeSnapshotReview(breachSnapshot, { price: 65 }, asOf);
  check("现价跌破证伪线 70 → falsifierStatus.breached = true", rBreached.falsifierStatus[0].breached === true);
  check("越线时 withinBand 也应为 false（65 < bear=80）", rBreached.withinBand === false);
}

console.log("\n[3] 记分卡样本量门槛：样本不足诚实降级，不硬凑百分比");
{
  const mkSnap = (date, price) => ({
    ticker: "R7.SAMPLE", snapshotDate: date, thesis: "t",
    valuationPosition: "below_base", valuationBear: 80, valuationBase: 100, valuationBull: 120,
    valuationCurrency: "USD", priceAtSnapshot: price, falsifiers: [], sessionId: null
  });
  const asOf = "2026-06-30";
  // 只有 1 条满 14 天的快照 → 样本不足（MIN_MATURE_SAMPLES=3）
  const scInsufficient = computeTickerScorecard([mkSnap("2026-06-01", 90)], { price: 105 }, asOf);
  check(`样本不足（<${MIN_MATURE_SAMPLES}）时 insufficientSample=true 且不产出百分比`, scInsufficient.insufficientSample === true && scInsufficient.withinBandRate === undefined);
  check("样本不足时给出可读的诚实提示文案", typeof scInsufficient.message === "string" && scInsufficient.message.includes("样本不足"));

  // 3 条都满 14 天且都在带内 → 应该有意义地统计出 100%
  const mature3 = [mkSnap("2026-01-01", 90), mkSnap("2026-02-01", 95), mkSnap("2026-03-01", 100)];
  const scSufficient = computeTickerScorecard(mature3, { price: 105 }, asOf);
  check(`样本足够（≥${MIN_MATURE_SAMPLES}）时给出 withinBandRate`, scSufficient.insufficientSample === false && scSufficient.withinBandRate === 100);

  // 全局记分卡：跨两只票汇总，同样门槛
  const global = computeGlobalScorecard([
    { ticker: "R7.SAMPLE", scorecard: scSufficient },
    { ticker: "R7.TEST2", scorecard: scInsufficient }
  ]);
  check("全局记分卡：汇总两只票的成熟样本数", global.matureSampleSize === scSufficient.matureSampleSize + scInsufficient.matureSampleSize);
  check(`MIN_MATURE_DAYS 常量导出且为正数（当前 ${MIN_MATURE_DAYS} 天）`, MIN_MATURE_DAYS > 0);
}

console.log("\n[4] companyPortrait.updatePortraitFromPanel：判断变化时落快照，未变不落（不写流水账）");
{
  const panel1 = { ticker: "R7.PORT", companyName: "复盘测试公司", researchStatus: "watch", confidence: "中",
    oneLineView: "首轮判断：低估", price: { value: "50 USD" }, riskTriggers: ["股价跌破 40 美元"] };
  const valuation1 = { method: "PE", bear: 40, base: 55, bull: 70, currentPrice: 50 };
  updatePortraitFromPanel({ ticker: "R7.PORT", panel: panel1, valuation: valuation1, question: "q1", answerContent: "", sessionId: "sess-a" });
  const afterFirst = listSnapshots("R7.PORT");
  check("首轮建档 → 落 1 条快照", afterFirst.length === 1);
  check("快照的 valuation_position 正确派生（50 < base=55 → below_base）", afterFirst[0].valuationPosition === "below_base");
  check("快照价格取自 valuation.currentPrice", afterFirst[0].priceAtSnapshot === 50);

  // 同样的判断再来一轮（thesis 不变）→ 不应新增快照
  updatePortraitFromPanel({ ticker: "R7.PORT", panel: panel1, valuation: valuation1, question: "q1-repeat", answerContent: "", sessionId: "sess-a2" });
  check("判断未变的第二轮 → 不新增快照（不写流水账）", listSnapshots("R7.PORT").length === 1);

  // 判断变化（thesis 改变）→ 应新增一条
  const panel2 = { ...panel1, oneLineView: "判断变化：转向高估" };
  const valuation2 = { method: "PE", bear: 40, base: 55, bull: 70, currentPrice: 60 };
  updatePortraitFromPanel({ ticker: "R7.PORT", panel: panel2, valuation: valuation2, question: "q2", answerContent: "", sessionId: "sess-b" });
  const afterChange = listSnapshots("R7.PORT");
  check("判断变化 → 新增第 2 条快照", afterChange.length === 2);
  check("第二条快照的 valuation_position 随现价变化（60 > base=55 → above_base）", afterChange[1].valuationPosition === "above_base");
}

console.log("\n[5] scheduler review_reminder 任务");
await checkAsync("无研究快照的 ticker → 不提醒", async () => {
  const job = JOBS.find((j) => j.id === "review_reminder");
  assert.ok(job, "JOBS 应包含 review_reminder");
  const before = listNotifications(50).length;
  insertResearchSnapshot({
    ticker: "R7.FRESH", snapshotDate: new Date().toISOString().slice(0, 10), thesis: "刚建的档",
    valuationPosition: "below_base", valuationBear: 10, valuationBase: 20, valuationBull: 30,
    valuationCurrency: "USD", priceAtSnapshot: 15, falsifiers: [], sessionId: null
  });
  await job.run();
  const after = listNotifications(50);
  const reminded = after.filter((n) => n.kind === "review_reminder" && n.ticker === "R7.FRESH");
  assert.equal(reminded.length, 0, "刚建档（0 天）不该被提醒复盘");
  assert.ok(after.length >= before, "不应减少通知数");
});

await checkAsync("快照超过 30 天没更新 → 提醒复盘", async () => {
  const job = JOBS.find((j) => j.id === "review_reminder");
  const oldDate = new Date(Date.now() - 40 * 86400000).toISOString();
  // 直接写一条 40 天前的快照（模拟"久未复盘"）。
  const { getDb } = await import("../src/db/index.js");
  getDb().prepare(`
    INSERT INTO research_snapshots (ticker, snapshot_date, thesis, price_at_snapshot, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run("R7.STALE", oldDate.slice(0, 10), "很久没复盘的判断", 42, oldDate.slice(0, 19).replace("T", " "));
  await job.run();
  const notifs = listNotifications(50);
  const reminded = notifs.filter((n) => n.kind === "review_reminder" && n.ticker === "R7.STALE");
  assert.equal(reminded.length, 1, "超过 30 天没更新的快照应触发一条复盘提醒");
});

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
