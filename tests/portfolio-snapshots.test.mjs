// M-1 测试：持仓一级页面的后端支柱——每日组合快照（PLAN v4 E9）。
// [1] computeSnapshotTotals：纯函数，多币种汇总/缺现价降级为 null（不是 0）/空组合。
// [2] portfolioSnapshots 仓库：upsert 幂等（同一天覆盖不追加）+ 按日期升序取最近 N 天。
// [3] scheduler JOBS 注册表：portfolio_snapshot 任务已注册且形状正确。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { computeSnapshotTotals } from "../src/server/services/portfolioSnapshot.js";
import { upsertSnapshot, listSnapshots } from "../src/server/repositories/portfolioSnapshotsRepository.js";
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

console.log("[1] computeSnapshotTotals（纯函数）");

check("多币种持仓正确折算总市值/成本/浮盈，并保留分币种明细", () => {
  const enriched = [
    { ticker: "AAPL", currency: "USD", marketValue: 1000, costValue: 800 },
    { ticker: "0700.HK", currency: "HKD", marketValue: 7800, costValue: 7800 } // ≈$1000 折算后
  ];
  const totals = computeSnapshotTotals(enriched);
  assert.equal(totals.positionCount, 2);
  assert.equal(totals.totalValueUsd, 2000); // 1000 + 7800/7.8
  assert.equal(totals.totalCostUsd, 1800); // 800 + 7800/7.8
  assert.equal(totals.totalPnlUsd, 200);
  assert.equal(totals.totals.length, 2);
  const hkd = totals.totals.find((t) => t.currency === "HKD");
  assert.equal(hkd.marketValue, 7800); // 明细保留原币种，不折算
});

check("没有一笔核到现价时，总市值是 null 而不是 0（红线5：缺失≠归零）", () => {
  const enriched = [
    { ticker: "AAPL", currency: "USD", marketValue: null, costValue: null },
    { ticker: "MSFT", currency: "USD", marketValue: null, costValue: null }
  ];
  const totals = computeSnapshotTotals(enriched);
  assert.equal(totals.totalValueUsd, null);
  assert.equal(totals.totalCostUsd, null);
  assert.equal(totals.totalPnlUsd, null);
  assert.equal(totals.positionCount, 2);
});

check("空组合返回 positionCount=0、totals=[]，不报错", () => {
  const totals = computeSnapshotTotals([]);
  assert.equal(totals.positionCount, 0);
  assert.deepEqual(totals.totals, []);
  assert.equal(totals.totalValueUsd, null);
});

check("部分持仓缺现价时，只用核到的那部分折算合计（不因缺失中断整体计算）", () => {
  const enriched = [
    { ticker: "AAPL", currency: "USD", marketValue: 500, costValue: 400 },
    { ticker: "NVDA", currency: "USD", marketValue: null, costValue: null }
  ];
  const totals = computeSnapshotTotals(enriched);
  assert.equal(totals.totalValueUsd, 500);
  assert.equal(totals.positionCount, 2); // 计数仍是全部持仓，不是只算核到价的那部分
});

console.log("\n[2] portfolioSnapshots 仓库（落库/幂等/取最近 N 天）");

check("upsertSnapshot 落库后 listSnapshots 能读回，字段完整", () => {
  upsertSnapshot({ date: "2026-07-01", totalValueUsd: 1000, totalCostUsd: 900, totalPnlUsd: 100, positionCount: 2, totals: [{ currency: "USD", marketValue: 1000 }] });
  const rows = listSnapshots(10);
  const row = rows.find((r) => r.date === "2026-07-01");
  assert.ok(row, "应能读回刚写入的快照");
  assert.equal(row.totalValueUsd, 1000);
  assert.equal(row.positionCount, 2);
  assert.equal(row.totals[0].currency, "USD");
});

check("同一天重复 upsert 是覆盖而不是追加（scheduler misfire 补跑安全）", () => {
  upsertSnapshot({ date: "2026-07-02", totalValueUsd: 1000, totalCostUsd: 900, totalPnlUsd: 100, positionCount: 2, totals: [] });
  upsertSnapshot({ date: "2026-07-02", totalValueUsd: 1500, totalCostUsd: 900, totalPnlUsd: 600, positionCount: 3, totals: [] });
  const rows = listSnapshots(200).filter((r) => r.date === "2026-07-02");
  assert.equal(rows.length, 1, "同一天应只有一行");
  assert.equal(rows[0].totalValueUsd, 1500, "应是覆盖后的最新值");
});

check("listSnapshots 按日期升序返回最近 N 天（不是随便 N 行，且不受更早日期干扰）", () => {
  // 前两个 check 已写入 2026-07-01/07-02；这里再写入更早的一批 06 月日期——
  // 最近 3 天应是"日期最大的 3 个"，不是"插入顺序最后的 3 个"或"随便截断的 3 行"。
  for (const d of ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"]) {
    upsertSnapshot({ date: d, totalValueUsd: 100, totalCostUsd: 90, totalPnlUsd: 10, positionCount: 1, totals: [] });
  }
  const rows = listSnapshots(3);
  assert.equal(rows.length, 3, "应只取最近 3 天");
  assert.deepEqual(rows.map((r) => r.date), ["2026-06-05", "2026-07-01", "2026-07-02"], "应是日期最大的 3 天，按日期升序排列");
});

console.log("\n[3] scheduler JOBS 注册表");

check("portfolio_snapshot 任务已注册（每日 08:05，run 是函数）", () => {
  const job = JOBS.find((j) => j.id === "portfolio_snapshot");
  assert.ok(job, "应存在 id=portfolio_snapshot 的任务");
  assert.equal(job.schedule.kind, "daily");
  assert.equal(job.schedule.at, "08:05");
  assert.equal(typeof job.run, "function");
});

console.log(`\nM-1: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
