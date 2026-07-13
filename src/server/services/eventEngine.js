/**
 * eventEngine — 事件引擎（对标 HoneClaw 的 event-engine pollers + digest）。
 *
 * 本地无常驻进程，所以做"按需 digest"：为已建画像/传入的公司列表拉取
 *   - 财报日历（FMP，临近财报倒计时）
 *   - 重大新闻（复用 newsData.getNewsSnapshot）
 *   - 持仓纪律（触及止损/止盈/大幅回撤）
 * 然后经三层过滤产出盘前/盘后 digest。
 *
 * 设计要点（这一版修了"有的公司经常出错"的体感问题）：
 *   1. 每家公司返回明确 status：ok / empty / error，错误不再被静默吞掉。
 *   2. digest 按公司分组（groups），并单列 failures，UI 能区分"今日无事件"与"抓取失败"。
 *   3. 港股财报：FMP 免费档不覆盖港股，拿不到时给出明确说明而不是装作正常。
 *   4. 分级新增 medium（财报/指引/评级/回购等），不再"非 high 即 low"刷屏。
 *
 * 严重度分级（确定性优先）：
 *   - 命中律所广告模板 → drop（永远是噪音）
 *   - 命中高影响关键词（破产/SEC调查/召回/被起诉/CEO辞任/收购等）→ high
 *   - 命中中影响关键词（财报/业绩/指引/分红/回购/评级/目标价/增减持等）→ medium
 *   - 其它 → low
 */

import { getNewsSnapshot } from "../../newsData.js";
import { getMarketSnapshot } from "../../marketData.js";
import { detectMarket } from "../../market.js";
import { beijingDate } from "../utils/time.js";
import { getPosition } from "../repositories/portfolioRepository.js";
import { getNextEarnings } from "./earningsCalendar.js";
import { listRules } from "../repositories/watchRulesRepository.js";
import { classifyNewsSeverity, dedupeSimilarNews, newsMentionsCompany } from "@echo/domain";
export { classifyNewsSeverity, dedupeSimilarNews, newsMentionsCompany } from "@echo/domain";

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };
const SEVERITY_LABEL = { high: "🔴 重要", medium: "🟡 关注", low: "⚪ 一般" };

const DEFAULT_PREFS = {
  blockedKinds: [],      // 例：["analyst_grade"] 静音整类
  highDailyCap: 8,       // High 事件每日上限（避免刷屏）
  lowPerCompany: 3       // 每家公司 low 新闻上限（避免单家刷屏）
};

/**
 * 拉取单个 ticker 的"下一业绩日"（Finnhub，港股经 ADR 映射），并在临近 T-14 内
 * 产出提醒事件；临近且该 ticker 有活跃证伪规则时，标注"N 条证伪条件将被检验"。
 * @returns {Promise<{ event: object|null, status: "ok"|"empty"|"error", reason?: string, earnings: object|null }>}
 */
async function fetchEarningsEvent(company, userId = "local") {
  let info;
  try {
    info = await getNextEarnings(company.ticker);
  } catch (error) {
    return { event: null, status: "error", reason: error.message || "财报日历请求失败", earnings: null };
  }
  if (info.providerStatus === "error") return { event: null, status: "error", reason: info.detail, earnings: null };
  if (info.providerStatus !== "ok" || !info.nextDate) return { event: null, status: "empty", earnings: info };

  const today = beijingDate();
  if (info.nextDate < today) return { event: null, status: "empty", earnings: info };
  const days = Math.round((new Date(info.nextDate).getTime() - new Date(today).getTime()) / 86400000);
  if (days > 14) return { event: null, status: "empty", earnings: info }; // 事件流只在 T-14 内提醒，earnings 字段本身不受此限制

  const activeRules = listRules(company.ticker, userId).length;
  const rulesNote = activeRules ? `，${activeRules} 条证伪条件将被检验` : "";
  return {
    status: "ok",
    earnings: info,
    event: {
      kind: "earnings",
      ticker: company.ticker,
      companyName: company.nameZh || company.ticker,
      severity: days <= 3 ? "high" : "medium",
      title: `${company.nameZh || company.ticker} 财报临近：${info.nextDate}（T-${days}）${rulesNote}`,
      date: info.nextDate,
      url: ""
    }
  };
}

/**
 * 拉取单个 ticker 的重大新闻事件（复用 newsData，确定性分级）。
 * @returns {Promise<{ events: object[], status: "ok"|"empty"|"error", reason?: string }>}
 */
async function fetchNewsEvents(company) {
  let snapshot;
  try {
    snapshot = await getNewsSnapshot(company);
  } catch (error) {
    return { events: [], status: "error", reason: error.message || "新闻源请求失败" };
  }
  if (snapshot?.providerStatus !== "ok") return { events: [], status: "empty" };
  const events = (snapshot.articles || [])
    .filter((a) => newsMentionsCompany(a, company))
    .map((a) => {
      const severity = classifyNewsSeverity(a);
      if (severity === "drop") return null;
      return {
        kind: "news",
        ticker: company.ticker,
        companyName: company.nameZh || company.ticker,
        severity,
        title: a.title || "",
        date: a.publishedAt || "",
        url: a.url || ""
      };
    })
    .filter(Boolean);
  return { events, status: events.length ? "ok" : "empty" };
}

/** 持仓纪律提醒：现价触及止损/止盈线，或相对成本大幅回撤时产出事件。 */
async function fetchPositionAlert(company, userId = "local") {
  const pos = getPosition(company.ticker, userId);
  if (!pos || (!pos.stopLoss && !pos.takeProfit && !pos.avgCost)) return null;
  let price;
  try {
    const snap = await getMarketSnapshot(company.ticker);
    price = snap?.providerStatus === "ok" ? snap.price : null;
  } catch {
    price = null;
  }
  if (price == null) return null;
  const name = company.nameZh || company.ticker;
  if (pos.stopLoss && price <= pos.stopLoss) {
    return { kind: "position_alert", line: "stop", ticker: company.ticker, companyName: name, severity: "high",
      title: `${name} 触及止损线：现价 ${price} ≤ 止损 ${pos.stopLoss}，按纪律复核是否减仓`, date: beijingDate(), url: "" };
  }
  if (pos.takeProfit && price >= pos.takeProfit) {
    return { kind: "position_alert", line: "take", ticker: company.ticker, companyName: name, severity: "high",
      title: `${name} 触及止盈线：现价 ${price} ≥ 止盈 ${pos.takeProfit}，按纪律复核是否兑现`, date: beijingDate(), url: "" };
  }
  if (pos.avgCost) {
    const drawdown = (price - pos.avgCost) / pos.avgCost;
    if (drawdown <= -0.2) {
      return { kind: "position_alert", line: "drawdown", ticker: company.ticker, companyName: name, severity: "medium",
        title: `${name} 相对成本回撤 ${(drawdown * 100).toFixed(0)}%（现价 ${price} / 成本 ${pos.avgCost}），复核投资逻辑是否仍成立`, date: beijingDate(), url: "" };
    }
  }
  return null;
}

/**
 * 轻量持仓触线巡检（给 scheduler 的 30 分钟盘中任务用）：
 * 只拉行情核对止损/止盈/回撤，不碰新闻/财报日历（那是盘前 digest 的事）。
 * @returns {Promise<object[]>} 命中的 position_alert 事件列表（带 line: stop|take|drawdown）
 */
export async function buildPositionAlerts(positions = [], userId = "local") {
  const alerts = await Promise.all(
    positions.map((pos) =>
      fetchPositionAlert({ ticker: pos.ticker, nameZh: pos.companyName }, userId).catch(() => null)
    )
  );
  return alerts.filter(Boolean);
}

/** 事件去重键：同 ticker 同类同标题视为一条。 */
function eventKey(e) {
  return `${e.ticker}|${e.kind}|${(e.title || "").slice(0, 60)}`;
}

/**
 * 为单家公司收集事件，并返回明确状态（错误不再被静默吞掉）。
 * @returns {Promise<{ ticker: string, companyName: string, market: string, status: "ok"|"empty"|"error", reasons: string[], events: object[], earnings: object|null }>}
 */
async function collectCompanyEvents(company, cfg, userId = "local") {
  const ticker = company.ticker;
  const companyName = company.nameZh || ticker;
  const market = detectMarket(ticker);
  const reasons = [];

  const [earnings, news, positionAlert] = await Promise.all([
    fetchEarningsEvent(company, userId),
    fetchNewsEvents(company),
    fetchPositionAlert(company, userId).catch(() => null)
  ]);

  const events = [];
  if (earnings.event) events.push(earnings.event);
  if (positionAlert) events.push(positionAlert);
  events.push(...(news.events || []));

  let errored = false;
  if (earnings.status === "error") { errored = true; reasons.push(`财报日历抓取失败：${earnings.reason}`); }
  else if (earnings.earnings?.providerStatus === "missing" && market === "HK") {
    reasons.push(earnings.earnings.detail || "港股财报日历暂缺，本轮只盯新闻与持仓纪律");
  }
  if (news.status === "error") { errored = true; reasons.push(`新闻抓取失败：${news.reason}`); }

  // 组内：blockedKinds 整类静音 → 精确去重 → 同题材新闻聚合（M-3 P11）→ 按 severity/日期排序 → low 限额。
  let kept = events.filter((e) => !cfg.blockedKinds.includes(e.kind));
  const seen = new Set();
  kept = kept.filter((e) => { const k = eventKey(e); if (seen.has(k)) return false; seen.add(k); return true; });
  kept = dedupeSimilarNews(kept);
  kept.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || String(b.date).localeCompare(String(a.date)));
  let lowSeen = 0;
  kept = kept.filter((e) => {
    if (e.severity !== "low") return true;
    if (lowSeen >= cfg.lowPerCompany) return false;
    lowSeen += 1;
    return true;
  });

  /** @type {"ok"|"empty"|"error"} */
  let status;
  if (errored && !kept.length) status = "error";
  else if (!kept.length) status = "empty";
  else status = "ok";

  return { ticker, companyName, market, status, reasons, events: kept, earnings: earnings.earnings || null };
}

/**
 * 为一组公司构建 digest。
 * @param {Array<{ticker: string, nameZh?: string}>} companies
 * @param {{blockedKinds?: string[], highDailyCap?: number, lowPerCompany?: number}} [prefs]
 * @param {{slot?: string, userId?: string}} [opts]
 * @returns {Promise<{generatedAt: string, slot: string, counts: Object, events: object[], groups: object[], failures: object[], summary: string, severityLabel: Object}>}
 */
export async function buildDigest(companies = [], prefs = {}, { slot = "premarket", userId = "local" } = {}) {
  const cfg = { ...DEFAULT_PREFS, ...prefs };
  const groups = await Promise.all(
    companies.slice(0, 30).map((company) => collectCompanyEvents(company, cfg, userId))
  );

  // 全局 High 日上限：跨公司限制 high 总量（避免整体刷屏）。
  let highBudget = cfg.highDailyCap;
  for (const g of groups) {
    g.events = g.events.filter((e) => {
      if (e.severity !== "high") return true;
      if (highBudget <= 0) return false;
      highBudget -= 1;
      return true;
    });
    // high 被砍光后可能重新变空。
    if (!g.events.length && g.status === "ok") g.status = "empty";
  }

  // groups 排序：有事件的优先，再按 high 数量、再按公司名稳定。
  const highCount = (g) => g.events.filter((e) => e.severity === "high").length;
  groups.sort((a, b) =>
    Number(b.events.length > 0) - Number(a.events.length > 0) ||
    highCount(b) - highCount(a) ||
    String(a.companyName).localeCompare(String(b.companyName))
  );

  const flat = groups.flatMap((g) => g.events);
  const counts = {
    high: flat.filter((e) => e.severity === "high").length,
    medium: flat.filter((e) => e.severity === "medium").length,
    low: flat.filter((e) => e.severity === "low").length
  };
  const failures = groups
    .filter((g) => g.status === "error")
    .map((g) => ({ ticker: g.ticker, companyName: g.companyName, reasons: g.reasons }));

  const slotLabel = slot === "premarket" ? "盘前" : "盘后";
  const summary = flat.length
    ? `${slotLabel}：${companies.length} 家公司，${counts.high} 条重要 / ${counts.medium} 条关注 / ${counts.low} 条一般${failures.length ? `；${failures.length} 家抓取失败` : ""}。`
    : `${slotLabel}：${companies.length} 家公司暂无值得提醒的事件${failures.length ? `（${failures.length} 家抓取失败，见下）` : ""}。`;

  return {
    generatedAt: new Date().toISOString(),
    slot,
    counts,
    events: flat,
    groups,
    failures,
    summary,
    severityLabel: SEVERITY_LABEL
  };
}
