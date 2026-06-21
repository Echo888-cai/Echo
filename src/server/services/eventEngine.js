/**
 * eventEngine — 事件引擎 MVP（对标 HoneClaw 的 event-engine pollers + digest）。
 *
 * 本地无常驻进程，所以做"按需 digest"：为已建画像/传入的公司列表拉取
 *   - 财报日历（FMP，临近财报倒计时）
 *   - 重大新闻（复用 newsData.getNewsSnapshot）
 * 然后经三层过滤产出盘前/盘后 digest。
 *
 * 过滤三层（对标 HoneClaw）：
 *   1. 全局反模板：律所/股东集体诉讼广告 → 强制丢弃（永远是噪音）
 *   2. 用户偏好：blockedKinds 把整类事件静音
 *   3. 冷却 + 日上限：同 ticker 同类事件冷却窗口内不重复，High 事件有日上限
 *
 * 严重度分级（确定性优先，LLM 仅对"不确定来源"可选仲裁）：
 *   - 命中律所广告模板 → drop
 *   - 命中高影响关键词（破产/SEC调查/召回/被起诉/CEO辞任/收购等）→ high
 *   - 财报临近 → medium
 *   - 其它 → low
 */

import { getNewsSnapshot } from "../../newsData.js";
import { getMarketSnapshot } from "../../marketData.js";
import { fmpGet, FMP_TTL } from "../../fmpClient.js";
import { fmpSymbol } from "../../market.js";
import { beijingDate } from "../utils/time.js";
import { getPosition } from "../repositories/portfolio.js";

// 1. 律所/股东诉讼广告反模板 → 强制丢弃（PR wire 噪音，不是公司事件）。
const LEGAL_AD_PATTERNS = [
  "shareholder alert", "investor alert", "investor deadline", "deadline alert",
  "class action", "securities fraud", "law firm", "law offices",
  "bernstein liebhard", "rosen law", "schall law", "pomerantz", "bragar eagel",
  "kessler topaz", "robbins geller", "investors who lost", "lost money",
  "投资者索赔", "集体诉讼", "律师事务所"
];

// 高影响关键词 → severity high。
const HIGH_IMPACT_PATTERNS = [
  "bankruptcy", "chapter 11", "sec probe", "sec investigation", "delisting",
  "recall", "lawsuit", "sued", "fraud", "ceo resign", "ceo steps down",
  "ceo departure", "acquisition", "merger", "buyout", "takeover", "guidance cut",
  "profit warning", "default", "restate", "data breach",
  "破产", "退市", "立案调查", "处罚", "召回", "起诉", "造假", "辞任", "收购", "重组", "下调指引", "业绩预警", "停牌"
];

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

function matchesAny(text, patterns) {
  const t = String(text || "").toLowerCase();
  return patterns.some((p) => t.includes(p.toLowerCase()));
}

/** 确定性新闻分级。返回 "drop" | "low" | "medium" | "high"。 */
export function classifyNewsSeverity(article = {}) {
  const text = `${article.title || ""} ${article.description || ""}`;
  if (matchesAny(text, LEGAL_AD_PATTERNS)) return "drop";
  if (matchesAny(text, HIGH_IMPACT_PATTERNS)) return "high";
  return "low";
}

const DEFAULT_PREFS = {
  blockedKinds: [],      // 例：["analyst_grade"] 静音整类
  highDailyCap: 8,       // High 事件每日上限（避免刷屏）
  cooldownHours: 12      // 同 ticker 同类事件冷却窗口
};

/** 拉取单个 ticker 的财报临近事件（FMP，缺数据优雅降级）。 */
async function fetchEarningsEvent(company) {
  const symbol = fmpSymbol(company.ticker);
  try {
    const rows = await fmpGet("/stable/earnings", { symbol, limit: 8 }, { ttl: FMP_TTL.estimates, timeoutMs: 5000 });
    const today = beijingDate();
    // 找最近的未来财报日。
    const upcoming = (Array.isArray(rows) ? rows : [])
      .map((r) => r.date || r.fiscalDateEnding || "")
      .filter((d) => d && d >= today)
      .sort()[0];
    if (!upcoming) return null;
    const days = Math.round((new Date(upcoming) - new Date(today)) / 86400000);
    if (days > 14) return null; // 只在 T-14 内提醒
    return {
      kind: "earnings",
      ticker: company.ticker,
      companyName: company.nameZh || company.ticker,
      severity: days <= 3 ? "high" : "medium",
      title: `${company.nameZh || company.ticker} 财报临近：${upcoming}（T-${days}）`,
      date: upcoming,
      url: ""
    };
  } catch {
    return null;
  }
}

/** 拉取单个 ticker 的重大新闻事件（复用 newsData，确定性分级）。 */
async function fetchNewsEvents(company) {
  try {
    const snapshot = await getNewsSnapshot(company);
    if (snapshot?.providerStatus !== "ok") return [];
    return (snapshot.articles || [])
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
  } catch {
    return [];
  }
}

/** 持仓纪律提醒：现价触及止损/止盈线，或相对成本大幅回撤时产出 high 事件。 */
async function fetchPositionAlert(company) {
  const pos = getPosition(company.ticker);
  if (!pos || (!pos.stopLoss && !pos.takeProfit && !pos.avgCost)) return null;
  let price = null;
  try {
    const snap = await getMarketSnapshot(company.ticker);
    price = snap?.providerStatus === "ok" ? snap.price : null;
  } catch {
    price = null;
  }
  if (price == null) return null;
  const name = company.nameZh || company.ticker;
  if (pos.stopLoss && price <= pos.stopLoss) {
    return { kind: "position_alert", ticker: company.ticker, companyName: name, severity: "high",
      title: `${name} 触及止损线：现价 ${price} ≤ 止损 ${pos.stopLoss}，按纪律复核是否减仓`, date: beijingDate(), url: "" };
  }
  if (pos.takeProfit && price >= pos.takeProfit) {
    return { kind: "position_alert", ticker: company.ticker, companyName: name, severity: "high",
      title: `${name} 触及止盈线：现价 ${price} ≥ 止盈 ${pos.takeProfit}，按纪律复核是否兑现`, date: beijingDate(), url: "" };
  }
  if (pos.avgCost) {
    const drawdown = (price - pos.avgCost) / pos.avgCost;
    if (drawdown <= -0.2) {
      return { kind: "position_alert", ticker: company.ticker, companyName: name, severity: "medium",
        title: `${name} 相对成本回撤 ${(drawdown * 100).toFixed(0)}%（现价 ${price} / 成本 ${pos.avgCost}），复核投资逻辑是否仍成立`, date: beijingDate(), url: "" };
    }
  }
  return null;
}

/** 事件去重键：同 ticker 同类同标题视为一条。 */
function eventKey(e) {
  return `${e.ticker}|${e.kind}|${(e.title || "").slice(0, 60)}`;
}

/**
 * 为一组公司构建 digest。
 * @param {Array} companies [{ ticker, nameZh }]
 * @param {object} prefs    { blockedKinds, highDailyCap, cooldownHours }
 * @returns { generatedAt, slot, events, summary, counts }
 */
export async function buildDigest(companies = [], prefs = {}, { slot = "premarket" } = {}) {
  const cfg = { ...DEFAULT_PREFS, ...prefs };
  const all = [];
  await Promise.all(
    companies.slice(0, 30).map(async (company) => {
      const [earnings, news, positionAlert] = await Promise.all([
        fetchEarningsEvent(company),
        fetchNewsEvents(company),
        fetchPositionAlert(company)
      ]);
      if (earnings) all.push(earnings);
      if (positionAlert) all.push(positionAlert);
      all.push(...news);
    })
  );

  // 第 2 层：用户偏好——blockedKinds 整类静音。
  let filtered = all.filter((e) => !cfg.blockedKinds.includes(e.kind));

  // 去重。
  const seen = new Set();
  filtered = filtered.filter((e) => {
    const k = eventKey(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // 排序：severity 高优先，再按日期近优先。
  filtered.sort((a, b) => {
    const s = (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0);
    if (s !== 0) return s;
    return String(a.date).localeCompare(String(b.date));
  });

  // 第 3 层：High 事件日上限（其余 severity 不限，但整体 cap 一个合理上限）。
  const highEvents = filtered.filter((e) => e.severity === "high").slice(0, cfg.highDailyCap);
  const restEvents = filtered.filter((e) => e.severity !== "high").slice(0, 20);
  const events = [...highEvents, ...restEvents];

  const counts = {
    high: events.filter((e) => e.severity === "high").length,
    medium: events.filter((e) => e.severity === "medium").length,
    low: events.filter((e) => e.severity === "low").length
  };

  return {
    generatedAt: new Date().toISOString(),
    slot,
    counts,
    events,
    summary: events.length
      ? `${slot === "premarket" ? "盘前" : "盘后"}：${companies.length} 家公司，${counts.high} 条重要 / ${counts.medium} 条关注 / ${counts.low} 条一般。`
      : `${slot === "premarket" ? "盘前" : "盘后"}：暂无值得提醒的事件。`
  };
}
