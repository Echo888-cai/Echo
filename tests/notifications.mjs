/**
 * P1 主动性跳变的测试：通知仓库（去重/已读）、notifier（无 token 跳过推送）、
 * scheduler 的到点判定（daily 补跑 / interval / 交易时段窗口）与状态落库。
 * 全部离线：不发任何网络请求（Telegram 未配置 → skipped 分支）。
 */
import "./setupTestDb.mjs";
import assert from "node:assert/strict";
import {
  insertNotification, listNotifications, unreadCount, markRead, markAllRead
} from "../src/server/repositories/notifications.js";
import { notify, sendTelegram, telegramConfigured } from "../src/server/services/notifier.js";
import { isDue, inTradingWindow, beijingParts, tickOnce, JOBS, schedulerStatus } from "../src/server/services/scheduler.js";

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

// 确保本套测试不受本机 .env 影响（notifier 直接读 process.env）。
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_CHAT_ID;

console.log("\n[1] notifications repository");
check("insert + list + unread 计数", () => {
  const a = insertNotification({ kind: "system", title: "hello", body: "world" });
  assert.ok(a?.id > 0);
  const list = listNotifications(10);
  assert.equal(list[0].title, "hello");
  assert.ok(unreadCount() >= 1);
});

check("dedupe：同 key 窗口期内只落一条", () => {
  const first = insertNotification({ kind: "position_alert", title: "触线A", dedupeKey: "pos:X:stop" });
  const dup = insertNotification({ kind: "position_alert", title: "触线A again", dedupeKey: "pos:X:stop" });
  assert.ok(first?.id > 0);
  assert.equal(dup, null);
});

check("markRead / markAllRead 闭环", () => {
  const { id } = insertNotification({ kind: "system", title: "read-me" });
  const before = unreadCount();
  markRead(id);
  assert.equal(unreadCount(), before - 1);
  markAllRead();
  assert.equal(unreadCount(), 0);
});

console.log("\n[2] notifier（无 Telegram 配置）");
await checkAsync("telegram 未配置 → sendTelegram 返回 skipped", async () => {
  assert.equal(telegramConfigured(), false);
  assert.equal(await sendTelegram("x"), "skipped");
});

await checkAsync("notify 落库成功且 telegram=skipped", async () => {
  const r = await notify({ kind: "digest", title: "盘前速报测试", body: "b" });
  assert.equal(r.ok, true);
  assert.ok(r.id > 0);
  assert.equal(r.telegram, "skipped");
});

await checkAsync("notify 带 dedupeKey 第二次被去重", async () => {
  await notify({ kind: "digest", title: "d1", dedupeKey: "digest:HK:2026-01-01" });
  const r2 = await notify({ kind: "digest", title: "d1", dedupeKey: "digest:HK:2026-01-01" });
  assert.equal(r2.deduped, true);
});

console.log("\n[3] scheduler 到点判定（纯函数）");
// 用固定 UTC 时点构造北京时间：北京 = UTC+8。
const bj = (dateStr, hm) => new Date(`${dateStr}T${hm}:00+08:00`);

check("daily：没到点不跑", () => {
  assert.equal(isDue({ kind: "daily", at: "09:00" }, null, bj("2026-07-01", "08:59")), false);
});

check("daily：到点且今天没跑过 → 跑（含开机补跑）", () => {
  assert.equal(isDue({ kind: "daily", at: "09:00" }, null, bj("2026-07-01", "09:00")), true);
  // 10:30 开机也补跑
  assert.equal(isDue({ kind: "daily", at: "09:00" }, null, bj("2026-07-01", "10:30")), true);
  // 昨天跑过、今天到点 → 跑
  const yesterdayRun = bj("2026-06-30", "09:01").toISOString();
  assert.equal(isDue({ kind: "daily", at: "09:00" }, yesterdayRun, bj("2026-07-01", "09:00")), true);
});

check("daily：今天跑过就不再跑", () => {
  const todayRun = bj("2026-07-01", "09:02").toISOString();
  assert.equal(isDue({ kind: "daily", at: "09:00" }, todayRun, bj("2026-07-01", "15:00")), false);
});

check("interval：按间隔触发", () => {
  const sched = { kind: "interval", everyMinutes: 30 };
  assert.equal(isDue(sched, null, bj("2026-07-01", "10:00")), true);
  const ranAt = bj("2026-07-01", "10:00").toISOString();
  assert.equal(isDue(sched, ranAt, bj("2026-07-01", "10:10")), false);
  assert.equal(isDue(sched, ranAt, bj("2026-07-01", "10:30")), true);
});

check("interval + tradingHoursOnly：时段外不跑", () => {
  const sched = { kind: "interval", everyMinutes: 30, tradingHoursOnly: true };
  // 2026-07-01 是周三：早上 07:00 非交易时段；10:00 港股时段；22:00 美股时段；周日全天不跑
  assert.equal(isDue(sched, null, bj("2026-07-01", "07:00")), false);
  assert.equal(isDue(sched, null, bj("2026-07-01", "10:00")), true);
  assert.equal(isDue(sched, null, bj("2026-07-01", "22:00")), true);
  assert.equal(isDue(sched, null, bj("2026-07-05", "10:00")), false); // 周日
});

check("交易时段窗口：美股跨零点尾段（北京周四 03:00 = 美股周三时段）", () => {
  assert.equal(inTradingWindow(bj("2026-07-02", "03:00")), true);  // 周四凌晨
  assert.equal(inTradingWindow(bj("2026-07-06", "03:00")), false); // 周一凌晨（周日无美股）
  const parts = beijingParts(bj("2026-07-02", "03:00"));
  assert.equal(parts.dow, 4);
});

console.log("\n[4] scheduler 引擎（真跑一轮，任务因无持仓/无公司秒回）");
await checkAsync("tickOnce 到点任务执行并落状态", async () => {
  // 选一个必到点的时刻：周三 10:00（港股 digest 09:00 已过 → 补跑；触线巡检在港股时段）
  const now = bj("2026-07-01", "10:00");
  const ran = await tickOnce(now);
  const ids = ran.map((r) => r.id);
  assert.ok(ids.includes("digest_hk"), `应包含 digest_hk，实际：${ids.join(",")}`);
  assert.ok(ids.includes("position_lines"), `应包含 position_lines，实际：${ids.join(",")}`);
  // 无关注公司/无持仓 → 任务应 ok 且说明跳过原因
  const st = schedulerStatus();
  const hk = st.jobs.find((j) => j.id === "digest_hk");
  assert.equal(hk.lastStatus, "ok");
  assert.ok(hk.lastRunAt);
});

await checkAsync("同一时点第二轮 tick 不重复执行", async () => {
  const now = bj("2026-07-01", "10:00");
  const ran = await tickOnce(now);
  assert.equal(ran.length, 0, `不应有任务执行，实际跑了：${ran.map((r) => r.id).join(",")}`);
});

check("JOBS 注册表完整（3 个内置任务）", () => {
  assert.equal(JOBS.length, 3);
  assert.ok(JOBS.every((j) => j.id && j.label && j.schedule && typeof j.run === "function"));
});

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
