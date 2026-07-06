// F-1 测试：factGuard 升档路径（命中留痕）+ 研究库每日备份（E8）。
// [1] factGuardRepository：insert 永不抛错、聚合统计（hard/soft 命中率、runsWithHard）正确。
// [2] chatOrchestrator.applyFactGuard：真实调用一次（无 hard/soft 命中的干净文本 + 一次带
//     hard 命中的文本），确认两次都落库、且 shadow 模式下不改变用户可见内容。
// [3] scheduler：db_backup 任务已注册、到点判定生效。
// [4] dbBackup：真实跑一次 runBackup（对着测试用的临时 DB），校验文件存在、integrity_check
//     通过、滚动保留生效——这是"能恢复"的真实验证，不是纸面承诺。
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { insertFactGuardAudit, getFactGuardStats, getRecentHardFails } from "../src/server/repositories/factGuardRepository.js";
import { applyFactGuard } from "../src/server/services/chatOrchestrator.js";
import { JOBS, isDue } from "../src/server/services/scheduler.js";
import { runBackup, listBackups, verifyBackup, backupDir } from "../src/server/services/dbBackup.js";

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

console.log("[1] factGuardRepository");
check("insertFactGuardAudit + getFactGuardStats：hard/soft 命中率聚合正确", () => {
  insertFactGuardAudit({ ticker: "TEST.HK", mode: "shadow", summary: { total: 4, pass: 2, soft: 1, hard: 1, hardDetails: [{ raw: "9999", dimension: "amount", reason: "数量级不符" }] } });
  insertFactGuardAudit({ ticker: "TEST.HK", mode: "shadow", summary: { total: 3, pass: 3, soft: 0, hard: 0, hardDetails: [] } });
  const stats = getFactGuardStats({ days: 14 });
  assert.equal(stats.runs, 2);
  assert.equal(stats.totalChecks, 7);
  assert.equal(stats.runsWithHard, 1);
  assert.equal(stats.hardRate, Math.round((1 / 7) * 1000) / 10);
  assert.equal(stats.softRate, Math.round((1 / 7) * 1000) / 10);
});

check("insertFactGuardAudit 永不抛错：summary 缺字段仍落一行带兜底 0", () => {
  assert.doesNotThrow(() => insertFactGuardAudit({ ticker: null, mode: undefined, summary: null }));
  const stats = getFactGuardStats({ days: 14 });
  assert.ok(stats.runs >= 3);
});

check("getRecentHardFails：只返回 hard_count > 0 的行，最新优先", () => {
  const rows = getRecentHardFails(10);
  assert.ok(rows.every((r) => r.hard_count > 0));
  assert.ok(rows.some((r) => r.ticker === "TEST.HK"));
});

console.log("\n[2] chatOrchestrator.applyFactGuard：真实校验 + 落库（shadow 模式，不改变输出）");
process.env.FACT_GUARD_MODE = "shadow";
await checkAsync("干净文本：无 hard/soft 命中，shadow 下原样返回，且落一行 pass", async () => {
  const before = getFactGuardStats({ days: 14 }).runs;
  const sources = {
    ticker: "0700.HK",
    marketSnapshot: { providerStatus: "ok", price: 380, currency: "HKD", changePercent: 1.2, pe: 18 }
  };
  const content = "腾讯现价 380 港元，PE 18 倍，今日涨跌幅 1.2%。";
  const result = await applyFactGuard({ content, sources, fallback: "（面板兜底文案）" });
  assert.equal(result.content, content, "shadow 模式不应修改正文");
  assert.equal(result.repaired, false);
  const after = getFactGuardStats({ days: 14 }).runs;
  assert.equal(after, before + 1, "应新增一行留痕");
});

await checkAsync("带明显错误数字：hard 命中仍落库（shadow 不拦截，但审计行要能看到 hard>0）", async () => {
  const sources = {
    ticker: "0700.HK",
    marketSnapshot: { providerStatus: "ok", price: 380, currency: "HKD" }
  };
  // 现价 380，正文写成完全数量级不符的数字，触发 hard。
  const content = "腾讯现价 3800000 港元。";
  const result = await applyFactGuard({ content, sources, fallback: "（兜底）" });
  assert.equal(result.content, content, "shadow 模式即使 hard 命中也不改变正文");
  const recent = getRecentHardFails(5);
  assert.ok(recent.some((r) => r.ticker === "0700.HK"), "应有一行 0700.HK 的 hard 命中留痕");
});
delete process.env.FACT_GUARD_MODE;

console.log("\n[3] scheduler：db_backup 任务已注册");
check("JOBS 含 db_backup，daily 03:30", () => {
  const job = JOBS.find((j) => j.id === "db_backup");
  assert.ok(job, "应有 db_backup 任务");
  assert.equal(job.schedule.kind, "daily");
  assert.equal(job.schedule.at, "03:30");
});

check("db_backup 到点判定：过了 03:30 且今天没跑过 → 该跑", () => {
  const bj = (dateStr, hm) => new Date(`${dateStr}T${hm}:00+08:00`);
  assert.equal(isDue({ kind: "daily", at: "03:30" }, null, bj("2026-07-06", "10:00")), true);
});

console.log("\n[4] dbBackup：真实备份 + 恢复校验 + 滚动保留（对着测试临时库）");
const tmpBackupDir = mkdtempSync(join(tmpdir(), "echo-backup-test-"));
process.env.LUVIO_BACKUP_DIR = tmpBackupDir;

await checkAsync("runBackup：真实生成备份文件，integrity_check 通过", async () => {
  const detail = await runBackup({ retain: 14 });
  assert.match(detail, /备份完成/);
  assert.match(detail, /恢复校验通过/);
  const files = listBackups(tmpBackupDir);
  assert.equal(files.length, 1);
  assert.ok(existsSync(files[0].path));
  const check1 = verifyBackup(files[0].path);
  assert.equal(check1.ok, true);
});

await checkAsync("滚动保留：超过 retain 的旧备份被清理", async () => {
  // 已有 1 份，retain=1 时再跑一次应保持只有 1 份（旧的被清掉）。
  await new Promise((r) => setTimeout(r, 1100)); // 时间戳文件名精度到秒，确保新文件名不同
  const detail = await runBackup({ retain: 1 });
  assert.match(detail, /保留 1 份/);
  const files = listBackups(tmpBackupDir);
  assert.equal(files.length, 1, "retain=1 时旧备份应被清理，只留最新一份");
});

check("backupDir()：LUVIO_BACKUP_DIR 覆盖生效", () => {
  assert.equal(backupDir(), tmpBackupDir);
});
delete process.env.LUVIO_BACKUP_DIR;

console.log(`\nF-1: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
