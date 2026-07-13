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
 * 环境开关：ECHO_DISABLE_SCHEDULER=1 完全禁用（CI/测试里用）。
 *
 * 测试性：isDue / inTradingWindow 是纯函数导出；tickOnce 可注入 now。
 */

import { getDb } from "../../db/index.js";
import { beijingDate, beijingMinute } from "../utils/time.js";
import { notify } from "./notifier.js";
import { buildDigest, buildPositionAlerts } from "./eventEngine.js";
import { listCompanyProfiles, getCompanyProfile, appendProfileEvent } from "../repositories/companyProfilesRepository.js";
import { listPositions } from "../repositories/portfolioRepository.js";
import { listWatchAdds, getHiddenTickers } from "../repositories/watchlistRepository.js";
import { listAllActiveRules, listRules, markTriggered } from "../repositories/watchRulesRepository.js";
import { evaluateRule, evaluateFundamentalRule, FUNDAMENTAL_METRIC_LABELS } from "./falsifyRules.js";
import { getMarketSnapshot } from "../../marketData.js";
import { getFinancials } from "../../financialData.js";
import { listSnapshotTickers } from "../repositories/researchSnapshotsRepository.js";
import { runBackup } from "./dbBackup.js";
import { getNextEarnings } from "./earningsCalendar.js";
import { listWithLastReported } from "../repositories/earningsCalendarRepository.js";
import { compactNumberServer } from "../utils/format.js";
import { recordDailySnapshot } from "./portfolioSnapshot.js";
import { listUsers } from "../repositories/authRepository.js";

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
function digestAudience(market /* "HK" | "US" */, userId = "local") {
  const byTicker = new Map();
  for (const p of listCompanyProfiles(30, userId)) byTicker.set(p.ticker, { ticker: p.ticker, nameZh: p.companyName });
  for (const pos of listPositions(userId)) if (!byTicker.has(pos.ticker)) byTicker.set(pos.ticker, { ticker: pos.ticker, nameZh: pos.companyName });
  for (const w of listWatchAdds(userId)) if (!byTicker.has(w.ticker)) byTicker.set(w.ticker, { ticker: w.ticker, nameZh: w.nameZh });
  const hidden = getHiddenTickers(userId);
  const isHk = (t) => /\.HK$/i.test(t) || /^\d{4,5}$/.test(t);
  return [...byTicker.values()].filter((c) => !hidden.has(c.ticker) && (market === "HK" ? isHk(c.ticker) : !isHk(c.ticker)));
}

/** 盘前速报：跑事件引擎，有高/中级事件才通知（没事不打扰）。 */
async function runDigestJob(market, marketLabel, userId = "local") {
  const companies = digestAudience(market, userId);
  if (!companies.length) return `无${marketLabel}关注公司，跳过`;
  const digest = await buildDigest(companies, {}, { slot: "premarket", userId });
  const notable = (digest.events || []).filter((e) => e.severity === "high" || e.severity === "medium");
  if (!notable.length) return `${companies.length} 家公司无值得提醒的事件`;
  const lines = notable.slice(0, 6).map((e) => `${e.severity === "high" ? "🔴" : "🟡"} ${e.title}`);
  if (notable.length > 6) lines.push(`…还有 ${notable.length - 6} 条，打开 Echo Research 查看`);
  const day = beijingDate();
  await notify({
    kind: "digest",
    title: `盘前速报 · ${marketLabel} ${day.slice(5)}`,
    body: `${digest.summary}\n\n${lines.join("\n")}`,
    payload: { slot: "premarket", market, counts: digest.counts },
    dedupeKey: `digest:${market}:${day}`,
    dedupeWindowHours: 20,
    userId
  });
  return `${notable.length} 条重要/关注事件已通知`;
}

/** 盘中触线巡检：只核对止损/止盈/回撤，逐条通知（同一根线 12h 内不重复）。 */
async function runPositionLinesJob(userId = "local") {
  const positions = listPositions(userId);
  if (!positions.length) return "无持仓，跳过";
  const alerts = await buildPositionAlerts(positions, userId);
  if (!alerts.length) return `${positions.length} 笔持仓未触线`;
  for (const a of alerts) {
    await notify({
      kind: "position_alert",
      title: a.title,
      ticker: a.ticker,
      payload: { line: a.line, severity: a.severity },
      dedupeKey: `position:${a.ticker}:${a.line}`,
      dedupeWindowHours: 12,
      userId
    });
  }
  return `${alerts.length} 条触线提醒已通知`;
}

/** 证伪监控巡检：核对研究沉淀下来的价格类证伪条件，命中 → 通知（同规则 24h 一次）。 */
async function runFalsifyWatchJob(userId = "local") {
  const rules = listAllActiveRules(userId);
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
      markTriggered(rule.id, userId);
      await notify({
        kind: "falsify_alert",
        title: `${ticker} 证伪条件命中：${rule.label}`,
        body: `现价 ${price}，触发线 ${rule.threshold}（${rule.kind === "price_below" ? "跌破" : "涨破"}）。这是你研究时自己定的证伪条件——按纪律复核投资逻辑是否已被推翻。`,
        ticker,
        payload: { ruleId: rule.id, price, threshold: rule.threshold, kind: rule.kind, sessionId: rule.sessionId || null },
        dedupeKey: `falsify:${ticker}:${rule.id}`,
        dedupeWindowHours: 24,
        userId
      });
    }
  }
  return `${rules.length} 条规则核对完成，${hits} 条命中`;
}

// R7 Phase C：判断快照超过这么多天没更新（=没重新研究过），提醒该复盘了。
const REVIEW_REMINDER_DAYS = 30;

/** 研究复盘提醒：某票最近一次判断快照超过 30 天没更新，提醒回顾当时的主线是否仍成立。 */
async function runReviewReminderJob(userId = "local") {
  const tickers = listSnapshotTickers(userId);
  if (!tickers.length) return "无研究快照，跳过";
  const today = beijingDate();
  let reminded = 0;
  for (const t of tickers) {
    const lastDate = String(t.lastSnapshotAt || "").slice(0, 10);
    if (!lastDate) continue;
    const days = Math.round((new Date(today).getTime() - new Date(lastDate).getTime()) / 86400000);
    if (!(days >= REVIEW_REMINDER_DAYS)) continue;
    const profile = getCompanyProfile(t.ticker, userId);
    const name = profile?.companyName || t.ticker;
    await notify({
      kind: "review_reminder",
      title: `${name} 该复盘一下了：上次判断快照是 ${days} 天前`,
      body: `当时的投资主线：${profile?.thesis || "（未记录）"}。回顾一下这个判断跟现在的价格/基本面对比是否还成立。`,
      ticker: t.ticker,
      payload: { lastSnapshotAt: t.lastSnapshotAt, daysSinceSnapshot: days },
      dedupeKey: `review:${t.ticker}:${lastDate}`,
      dedupeWindowHours: 24 * 29,
      userId
    });
    reminded += 1;
  }
  return `${tickers.length} 只票检查完成，${reminded} 条复盘提醒已通知`;
}

/** 研究库每日备份（E8，PLAN v3 F-1 顺手项）：在线备份 + 恢复校验 + 滚动保留 14 份。 */
async function runDbBackupJob() {
  return runBackup({ retain: 14 });
}

function surpriseLabel(pct) {
  if (pct == null) return "无法算惊喜幅度（预期缺失）";
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

/**
 * 业绩后复核：先刷新每只覆盖标的的财报日历（尊重 24h TTL，只有过期的才真正发请求），
 * 再看谁已核到"最近一期实际数字"——不按日期窗口筛选新旧（`last_date` 是财季结束日，
 * 不是公告日，免费档拿不到公告日，见 earningsCalendar.js 顶部说明），而是每次都尝试
 * 通知，靠 dedupeKey 按 ticker+year+quarter 去重——同一期报告只会真正提醒一次，
 * 不管 scheduler 哪天检测到它。画像时间线同理，靠事件内容自然幂等（重复运行不会
 * 让通知重复出现，只会让 appendProfileEvent 多写一行相同事件——可接受，时间线本来就
 * 允许同一天出现多条记录，前端渲染上不会造成误导）。
 */
async function runEarningsReviewJob(userId = "local") {
  const tickers = listSnapshotTickers(userId);
  if (!tickers.length) return "无研究快照，跳过";
  for (const t of tickers) {
    try { await getNextEarnings(t.ticker); } catch { /* 单只票刷新失败不影响其它票 */ }
  }
  // listWithLastReported() 是全表扫描（含所有被查过财报日历的 ticker，不限于本次覆盖范围）——
  // 必须按覆盖范围过滤，否则会把"只是随口问过一次下一财报日"的公司也拉进业绩后提醒名单，
  // 超出这个任务本该只服务"有真实研究判断"的标的这一范围（真实跑一轮抓到：AAPL+0700.HK
  // 都在库里时，只研究过 AAPL 的场景下 0700.HK 也被误通知了）。
  const coveredTickers = new Set(tickers.map((t) => t.ticker));
  const reported = listWithLastReported().filter((r) => coveredTickers.has(r.ticker));
  if (!reported.length) return `${tickers.length} 只票检查完成，暂无已核到实际值的财报`;

  let notified = 0;
  let fundamentalHits = 0;
  for (const r of reported) {
    const profile = getCompanyProfile(r.ticker, userId);
    const name = profile?.companyName || r.ticker;
    const period = r.last_year && r.last_quarter ? `${r.last_year}Q${r.last_quarter}` : "最近一期";
    const epsLine = `EPS 实际 ${r.last_eps_actual}${r.last_eps_estimate != null ? ` vs 预期 ${r.last_eps_estimate}` : ""}（${surpriseLabel(r.last_eps_surprise_pct)}）`;
    const revLine = r.last_revenue_actual != null
      ? `营收实际 ${compactNumberServer(r.last_revenue_actual)}${r.last_revenue_estimate != null ? ` vs 预期 ${compactNumberServer(r.last_revenue_estimate)}` : ""}（${surpriseLabel(r.last_revenue_surprise_pct)}）`
      : "营收：免费数据源无实际值，未核到";
    const result = await notify({
      kind: "earnings_review",
      title: `${name} ${period} 财报已公布`,
      body: `${epsLine}；${revLine}。去公司页看当时的证伪线是否仍成立、判断该不该跟着更新。`,
      ticker: r.ticker,
      payload: { lastDate: r.last_date, epsSurprisePct: r.last_eps_surprise_pct, revenueSurprisePct: r.last_revenue_surprise_pct },
      dedupeKey: `earnings_review:${r.ticker}:${period}`,
      dedupeWindowHours: 24 * 100,
      userId
    });
    if (!result?.deduped) {
      if (profile) {
        appendProfileEvent(r.ticker, {
          date: beijingDate(),
          kind: "earnings_report",
          summary: `${period} 财报：${epsLine}；${revLine}`,
          rationale: "F-2 业绩后自动核对（Finnhub 实际值 vs 预期，非模型推断）"
        }, userId);
      }
      notified += 1;
    }

    // F-3：基本面证伪条件核对——只在这只票真的设了这类规则时才拉一次财务数据（免得给
    // 没设规则的票也发一次多余请求）。跟"这期报告是否已经提醒过"无关：只要设了规则，
    // 每天都该看一眼当前财务是否已经踩线（命中通知本身有 24h dedupe，不会重复打扰）。
    const fundamentalRules = listRules(r.ticker, userId).filter((rule) => rule.kind.startsWith("fundamental_"));
    if (fundamentalRules.length) {
      try {
        const financials = await getFinancials(r.ticker);
        for (const rule of fundamentalRules) {
          const { triggered, sane, currentValue } = evaluateFundamentalRule(rule, financials);
          if (!sane || !triggered) continue;
          markTriggered(rule.id, userId);
          const metricLabel = FUNDAMENTAL_METRIC_LABELS[rule.metric] || rule.metric;
          const isAmount = rule.metric === "freeCashFlow";
          const valueLabel = isAmount ? compactNumberServer(currentValue) : `${currentValue}%`;
          const thresholdLabel = isAmount ? compactNumberServer(rule.threshold) : `${rule.threshold}%`;
          const fundamentalResult = await notify({
            kind: "falsify_alert",
            title: `${r.ticker} 证伪条件命中：${rule.label}`,
            body: `${metricLabel}最新值 ${valueLabel}，触发线 ${thresholdLabel}（${rule.kind === "fundamental_below" ? "跌破" : "超过"}）。这是你研究时自己定的证伪条件——按纪律复核投资逻辑是否已被推翻。`,
            ticker: r.ticker,
            payload: { ruleId: rule.id, currentValue, threshold: rule.threshold, kind: rule.kind, metric: rule.metric, sessionId: rule.sessionId || null },
            dedupeKey: `falsify:${r.ticker}:${rule.id}`,
            dedupeWindowHours: 24,
            userId
          });
          if (!fundamentalResult?.deduped) fundamentalHits += 1;
        }
      } catch { /* 单只票财务数据失败不影响其它票 */ }
    }
  }
  return `${tickers.length} 只票检查完成，${notified} 条业绩后提醒已通知` + (fundamentalHits ? `，${fundamentalHits} 条基本面证伪命中` : "");
}

function schedulerUserIds() {
  const ids = listUsers().map((user) => user.id);
  return ids.length ? ids : ["local"];
}

async function runForUsers(job) {
  const ids = schedulerUserIds();
  const details = [];
  for (const userId of ids) details.push(await job(userId));
  return ids.length === 1 ? details[0] : `${ids.length} 位用户：${details.join("；")}`;
}

/** 内置任务注册表（代码即配置，可版本管理）。 */
export const JOBS = [
  { id: "digest_hk", label: "港股盘前速报", schedule: { kind: "daily", at: "09:00" }, run: () => runForUsers((userId) => runDigestJob("HK", "港股", userId)) },
  { id: "digest_us", label: "美股盘前速报", schedule: { kind: "daily", at: "21:15" }, run: () => runForUsers((userId) => runDigestJob("US", "美股", userId)) },
  { id: "position_lines", label: "持仓触线巡检", schedule: { kind: "interval", everyMinutes: 30, tradingHoursOnly: true }, run: () => runForUsers(runPositionLinesJob) },
  { id: "falsify_watch", label: "证伪监控巡检", schedule: { kind: "interval", everyMinutes: 30, tradingHoursOnly: true }, run: () => runForUsers(runFalsifyWatchJob) },
  { id: "review_reminder", label: "研究复盘提醒", schedule: { kind: "daily", at: "08:00" }, run: () => runForUsers(runReviewReminderJob) },
  { id: "db_backup", label: "研究库每日备份", schedule: { kind: "daily", at: "03:30" }, run: runDbBackupJob },
  { id: "earnings_review", label: "业绩后复核", schedule: { kind: "daily", at: "07:30" }, run: () => runForUsers(runEarningsReviewJob) },
  // M-1（PLAN v4 E9）：08:05 时两市均已收盘（港股 16:00 HKT 收盘、美股最晚 04:10 北京时间收盘），
  // 各用最近收盘价折一份近似 USD 快照，喂持仓页净值曲线，也是数据护城河的自沉淀序列。
  { id: "portfolio_snapshot", label: "组合每日快照", schedule: { kind: "daily", at: "08:05" }, run: () => runForUsers(recordDailySnapshot) }
];

// ── 引擎 ─────────────────────────────────────────────────────

export function getState(jobId) {
  return getDb().prepare("SELECT * FROM scheduler_state WHERE job_id = ?").get(jobId) || null;
}

export function setState(jobId, { lastRunAt, status, detail }) {
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
  if (process.env.ECHO_DISABLE_SCHEDULER === "1") {
    console.log("[scheduler] ECHO_DISABLE_SCHEDULER=1，调度器未启动");
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
    enabled: process.env.ECHO_DISABLE_SCHEDULER !== "1",
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
