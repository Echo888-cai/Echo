/**
 * Portfolio routes:
 *
 * GET    /api/portfolio          → list positions, enriched with live price + P&L
 * POST   /api/portfolio          → upsert a position (manual add / edit)
 * DELETE /api/portfolio?ticker=  → remove a position
 *
 * Positions are recorded automatically from natural-language chat (cost / shares /
 * stop-loss / take-profit), and can also be added/edited manually via POST.
 */

import { sendOk, sendError, readJsonBody } from "../utils/async.js";
import { listPositions, upsertPosition, deletePosition } from "../repositories/portfolio.js";
import { computePortfolioReview } from "../services/portfolioReview.js";
import { getMarketSnapshot } from "../../marketData.js";
import { marketCurrency } from "../../market.js";
import { getCompanyByTickerComplete } from "../repositories/companyRepository.js";
import { listRules } from "../repositories/watchRules.js";
import { evaluateRule } from "../services/falsifyRules.js";
import { getNextEarnings } from "../services/earningsCalendar.js";
import { beijingDate } from "../utils/time.js";

/** 该持仓活跃证伪规则里离现价最近的一条（用于组合体检的"证伪临近"联动）。 */
function nearestFalsifierRule(ticker, price) {
  const rules = listRules(ticker);
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
async function nextEarningsInfo(ticker) {
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

/** Attach live price + unrealized P&L to a position. Degrades gracefully when no quote. */
async function enrichPosition(p) {
  let price = null;
  let currency = marketCurrency(p.ticker);
  let asOf = null;
  let priceStatus = "missing";
  try {
    const snap = await getMarketSnapshot(p.ticker);
    if (snap?.providerStatus === "ok" && snap.price != null) {
      price = snap.price;
      currency = snap.currency || currency;
      asOf = snap.asOf;
      priceStatus = "ok";
    }
  } catch {
    // 行情源不可用时静默降级——前端显示"现价暂不可用"。
  }
  const out = { ...p, currentPrice: price, currency, asOf, priceStatus };
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
  const { ruleCount, nearestRule } = nearestFalsifierRule(p.ticker, price);
  out.falsifierRuleCount = ruleCount;
  out.nearestFalsifierRule = nearestRule;
  out.nextEarnings = await nextEarningsInfo(p.ticker);
  return out;
}

export async function handlePortfolioList(req, res) {
  try {
    const positions = listPositions();
    const enriched = await Promise.all(positions.map(enrichPosition));
    sendOk(res, { positions: enriched });
  } catch (error) {
    sendError(res, 500, error.message || "获取持仓失败");
  }
}

/** GET /api/portfolio/review → 组合体检（复用 enrich 的现价/盈亏，纯函数计算）。 */
export async function handlePortfolioReview(req, res) {
  try {
    const positions = listPositions();
    const enriched = await Promise.all(positions.map(enrichPosition));
    sendOk(res, { review: computePortfolioReview(enriched) });
  } catch (error) {
    sendError(res, 500, error.message || "组合体检失败");
  }
}

const toNum = (v) => {
  if (v === "" || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export async function handlePortfolioUpsert(req, res) {
  try {
    const body = await readJsonBody(req);
    const ticker = (body.ticker || "").trim();
    if (!ticker) { sendError(res, 400, "缺少 ticker"); return; }
    const position = upsertPosition(ticker, {
      companyName: body.companyName,
      shares: toNum(body.shares),
      avgCost: toNum(body.avgCost),
      stopLoss: toNum(body.stopLoss),
      takeProfit: toNum(body.takeProfit),
      note: body.note
    });
    sendOk(res, { position: await enrichPosition(position) });
  } catch (error) {
    sendError(res, 500, error.message || "保存持仓失败");
  }
}

export async function handlePortfolioDelete(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const ticker = url.searchParams.get("ticker");
    if (!ticker) { sendError(res, 400, "缺少 ticker"); return; }
    const deleted = deletePosition(ticker);
    if (!deleted) { sendError(res, 404, "未找到该持仓"); return; }
    sendOk(res, { deleted: true, ticker });
  } catch (error) {
    sendError(res, 500, error.message || "删除持仓失败");
  }
}
