/**
 * portfolioEnrich — 持仓「加现价/盈亏/证伪临近/下一业绩日」的丰富化（从 routes/portfolio.js
 * 抽出到 service 层，M-1：scheduler 的每日快照任务需要同一份丰富化逻辑，route 不该被
 * scheduler 引用——services 层是两者共同的下游）。
 */

import { getMarketSnapshot } from "../../marketData.js";
import { marketCurrency } from "../../market.js";
import { getCompanyByTickerComplete } from "../repositories/companyRepository.js";
import { listRules } from "../repositories/watchRulesRepository.js";
import { evaluateRule } from "./falsifyRules.js";
import { getNextEarnings } from "./earningsCalendar.js";
import { beijingDate } from "../utils/time.js";

/** 该持仓活跃证伪规则里离现价最近的一条（用于组合体检的"证伪临近"联动）。 */
export function nearestFalsifierRule(ticker, price, userId = "local") {
  const rules = listRules(ticker, userId);
  if (!rules.length) return { ruleCount: 0, nearestRule: null };
  if (!(price > 0)) return { ruleCount: rules.length, nearestRule: null };
  let nearest = null;
  for (const rule of rules) {
    const { sane, distancePct, triggered } = evaluateRule(rule, price);
    if (!sane || distancePct == null) continue;
    if (!nearest || Math.abs(distancePct) < Math.abs(nearest.distancePct)) {
      nearest = { ruleId: rule.id, label: rule.label, kind: rule.kind, threshold: rule.threshold, distancePct, triggered };
    }
  }
  return { ruleCount: rules.length, nearestRule: nearest };
}

/** 该持仓的下一业绩日（Finnhub，24h TTL 缓存，港股经 ADR 核到；核不到时诚实返回 null）。 */
export async function nextEarningsInfo(ticker) {
  try {
    const info = await getNextEarnings(ticker);
    if (info.providerStatus !== "ok" || !info.nextDate) return null;
    const today = beijingDate();
    if (info.nextDate < today) return null;
    const days = Math.round((new Date(info.nextDate).getTime() - new Date(today).getTime()) / 86400000);
    return { date: info.nextDate, daysToEarnings: days };
  } catch {
    return null; // 财报日历不可用不阻断组合体检
  }
}

/** Attach live price + unrealized P&L (+ today's change) to a position. Degrades gracefully when no quote. */
export async function enrichPosition(p, userId = "local") {
  let price = null;
  let currency = marketCurrency(p.ticker);
  let asOf = null;
  let priceStatus = "missing";
  let changePct = null;
  try {
    const snap = await getMarketSnapshot(p.ticker);
    if (snap?.providerStatus === "ok" && snap.price != null) {
      price = snap.price;
      currency = snap.currency || currency;
      asOf = snap.asOf;
      priceStatus = "ok";
      changePct = typeof snap.changePercent === "number" ? snap.changePercent : null;
    }
  } catch {
    // 行情源不可用时静默降级——前端显示"现价暂不可用"。
  }
  const out = { ...p, currentPrice: price, currency, asOf, priceStatus, changePct };
  if (price != null && p.avgCost != null && p.avgCost !== 0) {
    out.returnPct = (price - p.avgCost) / p.avgCost;
    if (p.shares != null) {
      out.marketValue = price * p.shares;
      out.costValue = p.avgCost * p.shares;
      out.unrealizedPnl = out.marketValue - out.costValue;
    }
  }
  if (price != null && price !== 0 && p.stopLoss != null) out.toStopPct = (price - p.stopLoss) / price;
  if (price != null && price !== 0 && p.takeProfit != null) out.toTakePct = (p.takeProfit - price) / price;
  try {
    const company = getCompanyByTickerComplete(p.ticker);
    if (company) { out.sector = company.sector || null; out.industry = company.industry || null; }
  } catch {
    // companies 表查询失败不阻断持仓展示
  }
  const { ruleCount, nearestRule } = nearestFalsifierRule(p.ticker, price, userId);
  out.falsifierRuleCount = ruleCount;
  out.nearestFalsifierRule = nearestRule;
  out.nextEarnings = await nextEarningsInfo(p.ticker);
  return out;
}
