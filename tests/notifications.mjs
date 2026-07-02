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

check("JOBS 注册表完整（4 个内置任务）", () => {
  assert.equal(JOBS.length, 4);
  assert.ok(JOBS.every((j) => j.id && j.label && j.schedule && typeof j.run === "function"));
});

console.log("\n[5] 证伪规则解析（宁可漏，不可错）");
const { parseFalsifierRule, parseFalsifierRules, evaluateRule } = await import("../src/server/services/falsifyRules.js");
const { replaceFalsifierRules, listRules } = await import("../src/server/repositories/watchRules.js");

check("明确的价格条件 → 解析成规则", () => {
  assert.deepEqual(parseFalsifierRule("股价跌破 90 美元"), { kind: "price_below", threshold: 90, label: "股价跌破 90 美元" });
  assert.equal(parseFalsifierRule("跌破300港元").kind, "price_below");
  assert.equal(parseFalsifierRule("跌穿 4.2").threshold, 4.2);
  assert.equal(parseFalsifierRule("现价低于 85").kind, "price_below");
  assert.equal(parseFalsifierRule("股价涨破 150").kind, "price_above");
  assert.equal(parseFalsifierRule("升破 700 港元").kind, "price_above");
});

check("经营指标/百分比/金额量纲 → 拒绝解析（防假警报）", () => {
  assert.equal(parseFalsifierRule("云业务增速低于 20%"), null);
  assert.equal(parseFalsifierRule("毛利率跌破 40%"), null);
  assert.equal(parseFalsifierRule("营收跌破 500 亿"), null);
  assert.equal(parseFalsifierRule("月活用户低于 1 亿"), null);
  assert.equal(parseFalsifierRule("市占率失守 30%"), null);
  assert.equal(parseFalsifierRule("自由现金流低于 100 亿"), null);
  assert.equal(parseFalsifierRule("低于 50"), null); // 裸"低于"太泛，无价格上下文不解析
  assert.equal(parseFalsifierRule("技术突破 3 纳米"), null); // 裸"突破"太泛
});

check("批量解析去重", () => {
  const rules = parseFalsifierRules(["跌破 90 美元", "股价跌破 90", "涨破 150", "云增速低于 20%"]);
  assert.equal(rules.length, 2);
});

check("真实散文表述：短填充词 + markdown 强调", () => {
  const r = parseFalsifierRule("如果股价跌破本地档案看空线 **74.37 HKD**（对应 PE 约 4.9 倍），触发逻辑复核");
  assert.equal(r?.kind, "price_below");
  assert.equal(r?.threshold, 74.37);
  assert.equal(parseFalsifierRule("跌破发行价 78 港元").threshold, 78);
  // 均线/指引/金额单位仍拒绝
  assert.equal(parseFalsifierRule("跌破 50 日均线"), null);
  assert.equal(parseFalsifierRule("低于指引中位数 189M 美元"), null);
  // 估值倍数不是股价："PE 跌破 13x" / "PE 跌破 13"
  assert.equal(parseFalsifierRule("PE 跌破 13x：市场认为盈利是永久损失"), null);
  assert.equal(parseFalsifierRule("市盈率跌破 13"), null);
  // 但同句提到 PE 不影响真价格线（价格在前，倍数是括注）
  assert.equal(parseFalsifierRule("价格线证伪条件：若股价跌破 75 HKD（接近悲观情景价 74.37），则多头逻辑失效")?.threshold, 75);
});

await checkAsync("extractFalsifiersFromAnswer：从证伪段落抽条件行", async () => {
  const { extractFalsifiersFromAnswer } = await import("../src/server/services/companyPortrait.js");
  const md = [
    "结论", "阿里还行。", "",
    "## 7. 证伪条件",
    "- 股价跌破 **74.37 HKD**（悲观情景价）",
    "- 云业务增速连续两季低于 15%",
    "1. 回购规模腰斩",
    "",
    "我的判断",
    "以上。"
  ].join("\n");
  const items = extractFalsifiersFromAnswer(md);
  assert.equal(items.length, 3);
  assert.ok(items[0].includes("74.37"));
  assert.ok(!items.some((x) => x.includes("以上")));
});

await checkAsync("extractFalsifiersFromAnswer：松散结构（聚焦式证伪回答，无段落标题）", async () => {
  const { extractFalsifiersFromAnswer } = await import("../src/server/services/companyPortrait.js");
  // 按真实模型回答的形状构造（加粗价格线句 + "其他量化证伪阈值："引导 + 编号列表）
  const md = [
    "北京时间 2026-07-02 13:02，",
    "",
    "**价格线证伪条件：若股价跌破 75 HKD（接近本地档案悲观情景价 74.37），则多头逻辑失效，触发全面复核。**",
    "",
    "当前多头逻辑的前提是……（分析段落）",
    "",
    "**其他量化证伪阈值（按可观测性排序）：**",
    "",
    "1. **PE 跌破 13x**：市场认为盈利是永久损失。",
    "",
    "2. **云业务收入增速跌破 8%**：第二增长曲线证伪。",
    "",
    "3. **回购规模同比缩减超过 40%**：现金回报支撑消失。"
  ].join("\n");
  const items = extractFalsifiersFromAnswer(md);
  assert.ok(items.length >= 4, `应抽到≥4条，实际 ${items.length}：${JSON.stringify(items)}`);
  assert.ok(items[0].includes("75 HKD"), `价格线应在最前：${items[0]}`);
  assert.ok(items.some((x) => x.includes("云业务")));
});

check("evaluateRule：命中判定 + 合理性护栏", () => {
  const below = { kind: "price_below", threshold: 90 };
  assert.equal(evaluateRule(below, 89).triggered, true);
  assert.equal(evaluateRule(below, 91).triggered, false);
  assert.equal(evaluateRule({ kind: "price_above", threshold: 150 }, 151).triggered, true);
  // 阈值离现价 20 倍以上 → 解析到了非股价数字，不触发
  assert.equal(evaluateRule({ kind: "price_below", threshold: 5000 }, 90).sane, false);
  assert.equal(evaluateRule({ kind: "price_below", threshold: 5000 }, 90).triggered, false);
});

check("watchRules 仓库：整组重建幂等", () => {
  replaceFalsifierRules("TEST.X", [{ kind: "price_below", threshold: 90, label: "跌破 90" }]);
  replaceFalsifierRules("TEST.X", [
    { kind: "price_below", threshold: 85, label: "跌破 85" },
    { kind: "price_above", threshold: 200, label: "涨破 200" }
  ]);
  const rules = listRules("TEST.X");
  assert.equal(rules.length, 2);
  assert.equal(rules[0].threshold, 85);
});

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
