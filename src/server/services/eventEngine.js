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
import { detectMarket, bareSymbol } from "../../market.js";
import { beijingDate } from "../utils/time.js";
import { getPosition } from "../repositories/portfolioRepository.js";
import { getNextEarnings } from "./earningsCalendar.js";
import { listRules } from "../repositories/watchRulesRepository.js";

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

// 中影响关键词 → severity medium（值得关注、非紧急）。刻意避开"发布/新品"这类
// 过宽的词，以免普通公关稿被误抬到 medium。
const MEDIUM_IMPACT_PATTERNS = [
  "earnings", "quarterly results", "guidance", "outlook", "dividend", "buyback",
  "share repurchase", "upgrade", "downgrade", "price target", "raises stake",
  "cuts stake", "stake in", "guidance raise", "beats estimates", "misses estimates",
  "财报", "业绩", "营收", "净利", "毛利", "指引", "分红", "派息", "回购", "评级",
  "目标价", "增持", "减持", "中标", "募资", "定增", "扩产", "一致预期"
];

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };
const SEVERITY_LABEL = { high: "🔴 重要", medium: "🟡 关注", low: "⚪ 一般" };

function matchesAny(text, patterns) {
  const t = String(text || "").toLowerCase();
  return patterns.some((p) => t.includes(p.toLowerCase()));
}

/**
 * 相关性闸门：digest 是"我的公司发生了什么"，所以只保留正文真正提到该公司的新闻，
 * 滤掉竞品/同行业/大盘新闻混入（这是"事件经常出错"的主因——例如京东的 feed 里混进
 * 万事达、阿里的新闻，比亚迪混进大盘开盘综述）。
 */
export function newsMentionsCompany(article = {}, company = {}) {
  const raw = `${article.title || ""} ${article.description || ""}`;
  const text = raw.toLowerCase();
  const ticker = String(company.ticker || "");
  const sym = bareSymbol(ticker).toLowerCase();
  if (detectMarket(ticker) === "US") {
    // 美股：要求正文以词边界出现 ticker（如 JD、BABA），避开竞品括号代码混入。
    if (sym && new RegExp(`\\b${sym.replace(/[^a-z0-9]/g, "")}\\b`, "i").test(text)) return true;
  } else if (sym && text.includes(sym)) {
    return true; // 港股：数字代码偶尔出现在正文
  }
  // 中文名（去掉 -W / 股份 / 控股 / 集团 等后缀后的核心词）。
  const name = String(company.nameZh || "");
  const core = name.replace(/[-—]?[Ww]$/, "").replace(/股份|控股|集团|有限公司|公司/g, "").trim();
  if (core.length >= 2 && raw.includes(core)) return true;
  if (name.length >= 2 && raw.includes(name)) return true;
  return false;
}

/** 确定性新闻分级。返回 "drop" | "low" | "medium" | "high"。 */
export function classifyNewsSeverity(article = {}) {
  const text = `${article.title || ""} ${article.description || ""}`;
  if (matchesAny(text, LEGAL_AD_PATTERNS)) return "drop";
  if (matchesAny(text, HIGH_IMPACT_PATTERNS)) return "high";
  if (matchesAny(text, MEDIUM_IMPACT_PATTERNS)) return "medium";
  return "low";
}

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
 * P11 事件去重（M-3）：多个新闻源报同一天同一件事，措辞不同、`eventKey` 精确匹配抓不到——
 * 真实抓到的例子（0700.HK 同一天三条回购新闻，应合并成一条）：
 *   "腾讯控股(00700.HK)7月6日回购46.50万股，耗资2.05亿港元"
 *   "腾讯控股回购47万股 金额达2.05亿港元"
 *   "腾讯控股7月6日回购46.5万股股份"
 *
 * **第一版方案（字符 trigram 重叠率）被真实数据推翻**：同一天还抓到三条不同时间点的涨跌
 * 快讯——"腾讯控股涨超4%"（10:28）/"港股科网股拉升…腾讯控股涨超3%"（10:11）/"港股午盘｜
 * 恒指涨0.83% 腾讯控股涨近4%"（12:05），说的是三个不同时刻的不同涨幅，重叠率却算出
 * 0.6~0.8（因为"腾讯控股涨超4%"这类短标题的字符集几乎是任何提及同一公司的标题的子集，
 * 重叠系数天然偏高）——真实跑过一遍就复现了错误合并，Jaccard 相似度同样测过，两类真假
 * 案例的分数区间有重叠，找不到能同时保真阳性、零假阳性的单一阈值（详见 git history 的
 * 首版实现与验证过程）。通用文本相似度对这类高度模板化的短财经标题不可靠，遂放弃。
 *
 * **现方案：只认具体数字，不看措辞相似度。** 财经快讯的"回购"类新闻会携带一个具体的
 * 金额/股数（"2.05亿港元"“46.5万股”），不同来源转述同一笔交易时这个数字要么完全一致、
 * 要么四舍五入误差 <2%——而不同笔交易/不同时点的数字几乎不可能巧合相同。涨跌类快讯只有
 * 百分比（"4%"“0.83%”），百分比取值范围小、天天都在重复（"涨超4%"随时可能撞见另一条
 * 不相关新闻），特意不参与匹配——两条标题必须都能提取到具体金额/股数，且至少一个数字
 * 相对误差 ≤2%，才判定为同一事件；提不到数字的标题一律不参与聚合（宁可漏合并，
 * 不可错合并，红线：错合=0）。真实数据验证：三条回购新闻两两之间都能通过金额或股数匹配
 * （A/B 共享"2.05亿港元"，A/C 共享"46.5万股"附近的股数），全部正确聚合成一条；四条
 * 涨跌快讯因为提不出金额/股数 token，互相之间保证不会误合并。
 */
const AMOUNT_TOKEN_RE = /([\d]+(?:\.\d+)?)\s*(亿|万)\s*(港元|美元|元)/g;
const SHARE_TOKEN_RE = /([\d]+(?:\.\d+)?)\s*万\s*股/g;
const AMOUNT_MATCH_TOLERANCE = 0.02; // 相对误差 2%——覆盖"46.50万"vs"47万"这类四舍五入差异

/** 从标题里提取具体金额（统一换算成"元"）与股数（统一换算成"股"）token。 */
function extractNumberTokens(title) {
  const s = String(title || "");
  const out = [];
  let m;
  AMOUNT_TOKEN_RE.lastIndex = 0;
  while ((m = AMOUNT_TOKEN_RE.exec(s))) {
    const scale = m[2] === "亿" ? 1e8 : 1e4;
    out.push(parseFloat(m[1]) * scale);
  }
  SHARE_TOKEN_RE.lastIndex = 0;
  while ((m = SHARE_TOKEN_RE.exec(s))) {
    out.push(parseFloat(m[1]) * 1e4);
  }
  return out.filter((n) => Number.isFinite(n) && n > 0);
}

/** 两个标题是否共享至少一个（在容差内）相同的具体数字——判定"同一件事"的唯一依据。 */
function shareNumberToken(tokensA, tokensB) {
  for (const a of tokensA) {
    for (const b of tokensB) {
      if (Math.abs(a - b) / Math.max(a, b) <= AMOUNT_MATCH_TOLERANCE) return true;
    }
  }
  return false;
}

/**
 * 只对 kind==="news" 事件做同题材聚合（position_alert/earnings 是确定性生成的单条事件，
 * 没有"多源报道同一事实"的问题）。按 ticker+日历日分组后两两比较数字 token，
 * 传递聚类（A 与 B 共享数字、B 与 C 共享数字 → A/B/C 归一簇，即使 A/C 本身不共享）；
 * 最终展示标题取簇内最长的一条（信息量通常更完整），命中 ≥2 条时附 `relatedCount`。
 */
export function dedupeSimilarNews(events) {
  const passthrough = [];
  const byDay = new Map(); // "ticker|date" -> news events
  for (const e of events) {
    if (e.kind !== "news") { passthrough.push(e); continue; }
    const day = String(e.date || "").slice(0, 10);
    const key = `${e.ticker}|${day}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }
  const out = [...passthrough];
  for (const dayEvents of byDay.values()) {
    /** @type {Array<{tokens: number[], members: object[]}>} */
    const clusters = [];
    for (const e of dayEvents) {
      const tokens = extractNumberTokens(e.title);
      // 提不到数字的标题（如纯涨跌幅新闻）永远单独成簇，不参与任何匹配。
      const cluster = tokens.length ? clusters.find((c) => c.tokens.length && shareNumberToken(tokens, c.tokens)) : null;
      if (cluster) { cluster.members.push(e); cluster.tokens.push(...tokens); }
      else clusters.push({ tokens, members: [e] });
    }
    for (const c of clusters) {
      const rep = c.members.reduce((longest, m) =>
        String(m.title || "").length > String(longest.title || "").length ? m : longest
      );
      out.push(c.members.length > 1 ? { ...rep, relatedCount: c.members.length } : rep);
    }
  }
  return out;
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
