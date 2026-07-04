/**
 * scheduler — 进程内定时任务引擎（对标 HoneClaw 的 cron，砍掉 cron 表达式）。
 *
 * 为什么不用完整 cron：真实需求只有两种形态——
 *   daily    每天北京时间 HH:MM 跑一次（盘前速报）
 *   interval 每 N 分钟跑一次，可限定只在交易时段（持仓触线巡检）
 *
 * 可靠性模型（单进程、可能不常驻的现实）：
 *   - 任务状态（last_run_at）落 SQLite，进程重启不丢。
 *   - misfire 补跑：启动时立即 tick 一次；daily 任务只要"今天的时点已过且今天还没跑过"
 *     就补跑（比如 09:00 的港股速报，用户 10 点开机也能收到）。只补今天，不追历史。
 *   - 任务串行跑（for...await），一个任务失败不影响下一个，状态与错误落库可查。
 *
 * 环境开关：LUVIO_DISABLE_SCHEDULER=1 完全禁用（CI/测试里用）。
 *
 * 测试性：isDue / inTradingWindow 是纯函数导出；tickOnce 可注入 now。
 */

import { getDb } from "../../db/index.js";
import { beijingDate, beijingMinute } from "../utils/time.js";
import { notify } from "./notifier.js";
import { buildDigest, buildPositionAlerts } from "./eventEngine.js";
import { listCompanyProfiles } from "../repositories/companyProfiles.js";
import { listPositions } from "../repositories/portfolio.js";
import { listWatchAdds, getHiddenTickers } from "../repositories/watchlist.js";
import { listAllActiveRules, markTriggered } from "../repositories/watchRules.js";
import { evaluateRule } from "./falsifyRules.js";
import { getMarketSnapshot } from "../../marketData.js";

// ── 时间判定（纯函数，可测） ──────────────────────────────────

/** 北京时区的 { dow: 1(一)-7(日), hm: "HH:MM" }。 */
export function beijingParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(now);
  const pick = (t) => parts.find((p) => p.type === t)?.value || "";
  const dowMap = { 周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 7 };
  return { dow: dowMap[pick("weekday")] || 0, hm: `${pick("hour")}:${pick("minute")}` };
}

/**
 * 是否处于港/美股交易时段（北京时间，含小幅缓冲）：
 *   港股 周一-五 09:25–16:15；美股 周一-五 21:20 起，跨零点到次日（周二-六）04:10。
 * 夏令时差异（美股 21:30/22:30 开盘）不做精确切换——窗口取并集，多查一次没有成本。
 */
export function inTradingWindow(now = new Date()) {
  const { dow, hm } = beijingParts(now);
  const hk = dow >= 1 && dow <= 5 && hm >= "09:25" && hm <= "16:15";
  const usHead = dow >= 1 && dow <= 5 && hm >= "21:20";
  const usTail = dow >= 2 && dow <= 6 && hm <= "04:10";
  return hk || usHead || usTail;
}

/**
 * 任务是否到点。
 * @param {{kind: string, at?: string, everyMinutes?: number, tradingHoursOnly?: boolean}} schedule
 * @param {string|null} lastRunAtIso 上次运行的 ISO 时间（UTC），无则 null
 */
export function isDue(schedule, lastRunAtIso, now = new Date()) {
  if (schedule.kind === "daily") {
    const scheduledToday = `${beijingDate(now)} ${schedule.at}`;
    if (beijingMinute(now) < scheduledToday) return false; // 今天还没到点
    // 到点了：只要上次运行早于今天的时点（含从未运行），就该跑（含补跑）。
    const lastBeijing = lastRunAtIso ? beijingMinute(new Date(lastRunAtIso)) : "";
    return lastBeijing < scheduledToday;
  }
  if (schedule.kind === "interval") {
    if (schedule.tradingHoursOnly && !inTradingWindow(now)) return false;
    if (!lastRunAtIso) return true;
    const minutes = (now.getTime() - Date.parse(lastRunAtIso)) / 60000;
    return minutes >= schedule.everyMinutes;
  }
  return false;
}

// ── 任务实现 ─────────────────────────────────────────────────

/** digest 受众 = 画像 ∪ 持仓 ∪ 看盘手动关注 − 手动隐藏，再按市场过滤。 */
function digestAudience(market /* "HK" | "US" */) {
  const byTicker = new Map();
  for (const p of listCompanyProfiles(30)) byTicker.set(p.ticker, { ticker: p.ticker, nameZh: p.companyName });
  for (const pos of listPositions()) if (!byTicker.has(pos.ticker)) byTicker.set(pos.ticker, { ticker: pos.ticker, nameZh: pos.companyName });
  for (const w of listWatchAdds()) if (!byTicker.has(w.ticker)) byTicker.set(w.ticker, { ticker: w.ticker, nameZh: w.nameZh });
  const hidden = getHiddenTickers();
  const isHk = (t) => /\.HK$/i.test(t) || /^\d{4,5}$/.test(t);
  return [...byTicker.values()].filter((c) => !hidden.has(c.ticker) && (market === "HK" ? isHk(c.ticker) : !isHk(c.ticker)));
}

/** 盘前速报：跑事件引擎，有高/中级事件才通知（没事不打扰）。 */
async function runDigestJob(market, marketLabel) {
  const companies = digestAudience(market);
  if (!companies.length) return `无${marketLabel}关注公司，跳过`;
  const digest = await buildDigest(companies, {}, { slot: "premarket" });
  const notable = (digest.events || []).filter((e) => e.severity === "high" || e.severity === "medium");
  if (!notable.length) return `${companies.length} 家公司无值得提醒的事件`;
  const lines = notable.slice(0, 6).map((e) => `${e.severity === "high" ? "🔴" : "🟡"} ${e.title}`);
  if (notable.length > 6) lines.push(`…还有 ${notable.length - 6} 条，打开 Luvio 查看`);
  const day = beijingDate();
  await notify({
    kind: "digest",
    title: `盘前速报 · ${marketLabel} ${day.slice(5)}`,
    body: `${digest.summary}\n\n${lines.join("\n")}`,
    payload: { slot: "premarket", market, counts: digest.counts },
    dedupeKey: `digest:${market}:${day}`,
    dedupeWindowHours: 20
  });
  return `${notable.length} 条重要/关注事件已通知`;
}

/** 盘中触线巡检：只核对止损/止盈/回撤，逐条通知（同一根线 12h 内不重复）。 */
async function runPositionLinesJob() {
  const positions = listPositions();
  if (!positions.length) return "无持仓，跳过";
  const alerts = await buildPositionAlerts(positions);
  if (!alerts.length) return `${positions.length} 笔持仓未触线`;
  for (const a of alerts) {
    await notify({
      kind: "position_alert",
      title: a.title,
      ticker: a.ticker,
      payload: { line: a.line, severity: a.severity },
      dedupeKey: `position:${a.ticker}:${a.line}`,
      dedupeWindowHours: 12
    });
  }
  return `${alerts.length} 条触线提醒已通知`;
}

/** 证伪监控巡检：核对研究沉淀下来的价格类证伪条件，命中 → 通知（同规则 24h 一次）。 */
async function runFalsifyWatchJob() {
  const rules = listAllActiveRules();
  if (!rules.length) return "无证伪监控规则，跳过";
  // 按 ticker 归组，一只票只拉一次行情（走缓存，成本低）。
  const byTicker = new Map();
  for (const r of rules) {
    if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
    byTicker.get(r.ticker).push(r);
  }
  let hits = 0;
  for (const [ticker, tickerRules] of byTicker) {
    let price;
    try {
      const snap = await getMarketSnapshot(ticker);
      price = snap?.providerStatus === "ok" ? Number(snap.price) : null;
    } catch { price = null; }
    if (!(price > 0)) continue;
    for (const rule of tickerRules) {
      const { triggered } = evaluateRule(rule, price);
      if (!triggered) continue;
      hits += 1;
      markTriggered(rule.id);
      await notify({
        kind: "falsify_alert",
        title: `${ticker} 证伪条件命中：${rule.label}`,
        body: `现价 ${price}，触发线 ${rule.threshold}（${rule.kind === "price_below" ? "跌破" : "涨破"}）。这是你研究时自己定的证伪条件——按纪律复核投资逻辑是否已被推翻。`,
        ticker,
        payload: { ruleId: rule.id, price, threshold: rule.threshold, kind: rule.kind },
        dedupeKey: `falsify:${ticker}:${rule.id}`,
        dedupeWindowHours: 24
      });
    }
  }
  return `${rules.length} 条规则核对完成，${hits} 条命中`;
}

/** 内置任务注册表（代码即配置，可版本管理）。 */
export const JOBS = [
  { id: "digest_hk", label: "港股盘前速报", schedule: { kind: "daily", at: "09:00" }, run: () => runDigestJob("HK", "港股") },
  { id: "digest_us", label: "美股盘前速报", schedule: { kind: "daily", at: "21:15" }, run: () => runDigestJob("US", "美股") },
  { id: "position_lines", label: "持仓触线巡检", schedule: { kind: "interval", everyMinutes: 30, tradingHoursOnly: true }, run: runPositionLinesJob },
  { id: "falsify_watch", label: "证伪监控巡检", schedule: { kind: "interval", everyMinutes: 30, tradingHoursOnly: true }, run: runFalsifyWatchJob }
];

// ── 引擎 ─────────────────────────────────────────────────────

function getState(jobId) {
  return getDb().prepare("SELECT * FROM scheduler_state WHERE job_id = ?").get(jobId) || null;
}

function setState(jobId, { lastRunAt, status, detail }) {
  getDb().prepare(`
    INSERT INTO scheduler_state (job_id, last_run_at, last_status, last_detail)
    VALUES (@jobId, @lastRunAt, @status, @detail)
    ON CONFLICT(job_id) DO UPDATE SET last_run_at = excluded.last_run_at, last_status = excluded.last_status, last_detail = excluded.last_detail
  `).run({ jobId, lastRunAt, status, detail: String(detail || "").slice(0, 500) });
}

/** 跑一轮：检查每个任务是否到点，串行执行。可注入 now（测试用）。 */
export async function tickOnce(now = new Date()) {
  const ran = [];
  for (const job of JOBS) {
    const state = getState(job.id);
    if (!isDue(job.schedule, state?.last_run_at || null, now)) continue;
    const startedIso = now.toISOString();
    try {
      const detail = await job.run();
      setState(job.id, { lastRunAt: startedIso, status: "ok", detail });
      ran.push({ id: job.id, status: "ok", detail });
      console.log(`[scheduler] ${job.id} ok：${detail}`);
    } catch (err) {
      setState(job.id, { lastRunAt: startedIso, status: "error", detail: err?.message || String(err) });
      ran.push({ id: job.id, status: "error", detail: err?.message });
      console.error(`[scheduler] ${job.id} 失败：`, err?.message || err);
    }
  }
  return ran;
}

let timer = null;

/** 启动调度器：立即 tick 一次（misfire 补跑），之后每分钟一次。 */
export function startScheduler() {
  if (process.env.LUVIO_DISABLE_SCHEDULER === "1") {
    console.log("[scheduler] LUVIO_DISABLE_SCHEDULER=1，调度器未启动");
    return false;
  }
  if (timer) return true;
  void tickOnce().catch((err) => console.error("[scheduler] 首轮 tick 失败：", err));
  timer = setInterval(() => {
    void tickOnce().catch((err) => console.error("[scheduler] tick 失败：", err));
  }, 60_000);
  timer.unref?.(); // 不阻止进程正常退出
  console.log(`[scheduler] 已启动：${JOBS.map((j) => j.label).join(" / ")}`);
  return true;
}

/** 调度器状态（设置页展示用）。 */
export function schedulerStatus() {
  return {
    enabled: process.env.LUVIO_DISABLE_SCHEDULER !== "1",
    running: Boolean(timer),
    jobs: JOBS.map((job) => {
      const state = getState(job.id);
      return {
        id: job.id,
        label: job.label,
        schedule: job.schedule.kind === "daily"
          ? `每天 ${job.schedule.at}（北京时间）`
          : `每 ${job.schedule.everyMinutes} 分钟${job.schedule.tradingHoursOnly ? "（仅交易时段）" : ""}`,
        lastRunAt: state?.last_run_at || null,
        lastStatus: state?.last_status || "never",
        lastDetail: state?.last_detail || ""
      };
    })
  };
}
