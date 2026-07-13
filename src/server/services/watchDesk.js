/**
 * watchDesk — 盯盘台聚合（P0）。
 *
 * 把三处本来散着的东西焊成"每家公司一张卡"：
 *   - 画像（companyProfiles）：投资主线 / 证伪条件 / 置信度
 *   - 事件（eventEngine.buildDigest）：今日最重的一条事件 + 严重度
 *   - 持仓（portfolio）+ 行情（marketData）：现价 / 涨跌 / 盈亏 / 止损线
 *
 * 状态机（P0 确定性规则，不调模型；P1 再加"事件↔证伪条件"语义匹配）：
 *   - falsified 已触发证伪：持仓现价 ≤ 你预设的止损线（你自己设的"我错了就走"那条线）。
 *   - at_risk   有风险    ：出现重大利空新闻（high 级 news），或相对成本回撤 ≥ 20%。
 *   - intact    逻辑还在  ：以上都没有。
 * 刻意不把"财报临近(T-3)"这种日历事件算成风险——它只是日程，不是利空。
 */

import { buildDigest } from "./eventEngine.js";
import { getCompanyProfile, listCompanyProfiles } from "../repositories/companyProfilesRepository.js";
import { listPositions, getPosition } from "../repositories/portfolioRepository.js";
import { listWatchAdds, getHiddenTickers } from "../repositories/watchlistRepository.js";
import { listRules } from "../repositories/watchRulesRepository.js";
import { evaluateRule } from "@echo/domain";
import { getMarketSnapshot, getPriceSeries } from "../../marketData.js";
import { getFinancials, getCompanyProfile as getFundamentalsProfile } from "../../financialData.js";
import { detectMarket } from "../../market.js";
import { companyByTicker } from "../../data.js";

const STATUS_RANK = { falsified: 3, at_risk: 2, intact: 1 };

/** 关注范围：研究过的公司（画像）∪ 持仓。显式传 tickers 时以传入为准。 */
export function trackedUniverse(tickerParam, userId = "local") {
  if (tickerParam) {
    return tickerParam.split(",").map((t) => t.trim()).filter(Boolean).map((ticker) => {
      const c = companyByTicker(ticker);
      return { ticker, nameZh: c?.nameZh || ticker };
    });
  }
  const byTicker = new Map();
  for (const p of listCompanyProfiles(40, userId)) byTicker.set(p.ticker, { ticker: p.ticker, nameZh: p.companyName });
  for (const pos of listPositions(userId)) if (!byTicker.has(pos.ticker)) byTicker.set(pos.ticker, { ticker: pos.ticker, nameZh: pos.companyName });
  // 叠加手动关注：add 补进来，hide 剔出去。最终自选 = (研究过 ∪ 持仓 ∪ add) − hide。
  for (const a of listWatchAdds(userId)) if (!byTicker.has(a.ticker)) byTicker.set(a.ticker, { ticker: a.ticker, nameZh: a.nameZh });
  const hidden = getHiddenTickers(userId);
  return [...byTicker.values()].filter((c) => !hidden.has(c.ticker));
}

function toNum(value) {
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** 单家行情快照 → 卡片要的最小字段。拿不到就 unavailable，不编。 */
async function snapshotFor(ticker) {
  try {
    const s = await getMarketSnapshot(ticker);
    if (s?.providerStatus !== "ok" || s.price == null) return { priceStatus: "unavailable" };
    return { priceStatus: "ok", price: toNum(s.price), currency: s.currency || "", changePct: toNum(s.changePercent) };
  } catch {
    return { priceStatus: "unavailable" };
  }
}

/** 确定性状态机（见文件头注释）。triggeredRule = 命中的证伪监控规则（UX-7 闭环）。 */
function deriveStatus({ price, position, topNewsHigh, triggeredRule }) {
  const held = Boolean(position && position.avgCost != null);
  if (position?.stopLoss != null && price != null && price <= position.stopLoss) {
    return { status: "falsified", statusReason: `触及止损线 ${position.stopLoss}（纪律触发，复核是否减仓）` };
  }
  if (triggeredRule) {
    return { status: "falsified", statusReason: `研究时定的证伪条件命中：${triggeredRule.label}` };
  }
  if (topNewsHigh) return { status: "at_risk", statusReason: `重大利空：${topNewsHigh}` };
  if (held && price != null && position.avgCost) {
    const dd = (price - position.avgCost) / position.avgCost;
    if (dd <= -0.2) return { status: "at_risk", statusReason: `相对成本回撤 ${Math.round(dd * 100)}%，复核逻辑是否仍成立` };
  }
  return { status: "intact", statusReason: "" };
}

/** 该 ticker 的证伪监控规则 + 按现价的实时评估（列表/个股页共用）。 */
function evaluatedRules(ticker, price, userId = "local") {
  try {
    return listRules(ticker, userId).map((r) => ({ ...r, ...evaluateRule(r, price) }));
  } catch {
    return [];
  }
}

/**
 * 为一组公司构建盯盘台。
 * @param {Array<{ticker: string, nameZh?: string}>} companies
 * @param {{slot?: string, events?: boolean, userId?: string}} [opts]
 * @returns {Promise<{generatedAt: string, slot: string, cards: Array<Object>, counts: Object, failures: Array<Object>}>}
 */
export async function buildWatchDesk(companies = [], { slot = "premarket", events: withEvents = true, userId = "local" } = {}) {
  const universe = companies.slice(0, 30);
  // 事件复用现有 digest：每家的 events 已经过相关性/严重度过滤并排好序，卡片直接取最重那条。
  // fast 模式（withEvents=false）跳过 digest（新闻/财报日历是整盘刷新的慢源），先给价格与状态。
  const digest = withEvents ? await buildDigest(universe, {}, { slot, userId }) : { groups: [], failures: [] };
  const groupByTicker = new Map((digest.groups || []).map((g) => [g.ticker, g]));

  const cards = await Promise.all(universe.map(async (c) => {
    const ticker = c.ticker;
    const profile = getCompanyProfile(ticker, userId);
    const position = getPosition(ticker, userId);
    // spark 跟事件走慢阶段（fast 模式先给价格与状态）；序列有 30 分钟进程缓存，
    // 首轮未命中缓存的部分公司拿不到也无妨——sparkline 缺省不该拖垮整张卡。
    const [snap, spark] = await Promise.all([snapshotFor(ticker), withEvents ? sparkFor(ticker) : null]);
    const group = groupByTicker.get(ticker);
    const events = group?.events || [];
    const topEvent = events[0] || null;
    const earnings = group?.earnings || null;
    const topNewsHigh = events.find((e) => e.kind === "news" && e.severity === "high")?.title || "";

    const price = snap.priceStatus === "ok" ? snap.price : null;
    const rules = evaluatedRules(ticker, price, userId);
    const triggeredRule = rules.find((r) => r.triggered) || null;
    const { status, statusReason } = deriveStatus({ price, position, topNewsHigh, triggeredRule });
    const held = Boolean(position && position.avgCost != null);
    const returnPct = held && price != null ? (price - position.avgCost) / position.avgCost : null;

    return {
      ticker,
      companyName: profile?.companyName || c.nameZh || ticker,
      market: detectMarket(ticker),
      hasProfile: Boolean(profile),
      thesis: profile?.thesis || "",
      confidence: profile?.confidence || "",
      status,
      statusReason,
      topEvent: topEvent
        ? { severity: topEvent.severity, kind: topEvent.kind, title: topEvent.title, date: topEvent.date, url: topEvent.url || "" }
        : null,
      eventCount: events.length,
      // 下一业绩日（G-2）：独立于 events 之外常驻展示，不受 T-14 提醒窗口限制。
      earnings: earnings && earnings.providerStatus === "ok"
        ? { nextDate: earnings.nextDate, source: earnings.source }
        : null,
      // 看盘台个股页要展开"近期事件"时间线，所以把前几条也带上（卡片墙忽略它）。
      // relatedCount（M-3 P11 同题材聚合）要透传，否则前端的"同题材 n 条"折叠角标永远拿不到数据。
      events: events.slice(0, 6).map((e) => ({ severity: e.severity, kind: e.kind, title: e.title, date: e.date, url: e.url || "", relatedCount: e.relatedCount || undefined })),
      priceStatus: snap.priceStatus,
      price,
      currency: snap.currency || "",
      changePct: snap.changePct ?? null,
      held,
      returnPct,
      // 行内迷你曲线：近一月收盘 + 区间涨跌（慢阶段才有，fast 模式为 null）。
      spark,
      // 证伪监控（UX-7）：价格类规则 + 实时评估（triggered/距触发%）。个股页渲染监控块用。
      watchRules: rules
    };
  }));

  // 最紧急的浮到最上：已触发 → 有风险 → 逻辑还在；同档内高severity事件优先、事件多优先、名字稳定。
  cards.sort((a, b) =>
    (STATUS_RANK[b.status] - STATUS_RANK[a.status]) ||
    (Number(b.topEvent?.severity === "high") - Number(a.topEvent?.severity === "high")) ||
    (b.eventCount - a.eventCount) ||
    String(a.companyName).localeCompare(String(b.companyName))
  );

  const counts = {
    falsified: cards.filter((c) => c.status === "falsified").length,
    atRisk: cards.filter((c) => c.status === "at_risk").length,
    intact: cards.filter((c) => c.status === "intact").length,
    total: cards.length
  };

  return { generatedAt: new Date().toISOString(), slot, cards, counts, failures: digest.failures || [] };
}

/** 行内 sparkline 数据：近一月收盘价（≤22 个交易日）+ 区间涨跌%。失败静默缺省。 */
async function sparkFor(ticker) {
  try {
    const s = await getPriceSeries(ticker);
    if (s.providerStatus !== "ok" || !Array.isArray(s.points) || s.points.length < 5) return null;
    const pts = s.points.slice(-22).map((p) => Number(p.close)).filter(Number.isFinite);
    if (pts.length < 5) return null;
    const first = pts[0];
    const last = pts[pts.length - 1];
    return { points: pts, changePct: first ? ((last - first) / first) * 100 : 0 };
  } catch {
    return null;
  }
}

/**
 * 单只股票的看盘台个股页数据 = 该公司的盯盘卡（价格/状态/事件）+ 完整画像
 * （投资主线/多空/证伪/估值/置信度）。看盘台详情页的唯一数据源。
 */
export async function buildStockView(ticker, userId = "local") {
  const c = companyByTicker(ticker);
  const [desk, fundamentals, series] = await Promise.all([
    buildWatchDesk([{ ticker, nameZh: c?.nameZh || ticker }], { userId }),
    fetchFundamentals(ticker),
    getPriceSeries(ticker).catch(() => ({ providerStatus: "missing" }))
  ]);
  const card = desk.cards[0] || {
    ticker, companyName: c?.nameZh || ticker, market: detectMarket(ticker),
    status: "intact", statusReason: "", topEvent: null, eventCount: 0, events: [], earnings: null,
    priceStatus: "unavailable", price: null, currency: "", changePct: null, held: false, returnPct: null
  };
  const p = getCompanyProfile(ticker, userId);
  const profile = p ? {
    thesis: p.thesis, researchStatus: p.researchStatus, confidence: p.confidence,
    bull: p.bull, bear: p.bear, monitors: p.monitors, falsifiers: p.falsifiers,
    valuation: p.valuation, turnCount: p.turnCount, updatedAt: p.updatedAt
  } : null;
  return { ...card, profile, fundamentals, series };
}

/** 基本面速览（PE / 营收增速 / 毛利率 / 自由现金流）。任一源失败就诚实标 unavailable，不编数。 */
async function fetchFundamentals(ticker) {
  try {
    const [fin, prof] = await Promise.all([
      getFinancials(ticker).catch(() => null),
      getFundamentalsProfile(ticker).catch(() => null)
    ]);
    if ((!fin || fin.providerStatus !== "ok") && (!prof || prof.providerStatus !== "ok")) {
      return { status: "unavailable" };
    }
    return {
      status: "ok",
      pe: prof?.providerStatus === "ok" ? prof.pe : null,
      revenueGrowth: fin?.providerStatus === "ok" ? fin.revenueGrowth : null,
      grossMargin: fin?.providerStatus === "ok" ? fin.grossMargin : null,
      freeCashFlow: fin?.providerStatus === "ok" ? fin.freeCashFlow : null,
      currency: fin?.currency || "",
      period: fin?.period || ""
    };
  } catch {
    return { status: "unavailable" };
  }
}
