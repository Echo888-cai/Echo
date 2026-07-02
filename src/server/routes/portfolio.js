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
