/**
 * Portfolio routes:
 *
 * GET    /api/portfolio            → list positions, enriched with live price + P&L
 * GET    /api/portfolio/review     → portfolio discipline check (concentration/stop-loss/etc.)
 * GET    /api/portfolio/snapshots  → daily net-worth snapshots (M-1, for the net worth chart)
 * POST   /api/portfolio            → upsert a position (manual add / edit)
 * DELETE /api/portfolio?ticker=    → remove a position
 *
 * Positions are recorded automatically from natural-language chat (cost / shares /
 * stop-loss / take-profit), and can also be added/edited manually via POST.
 */

import { sendOk, sendError, readJsonBody } from "../utils/async.js";
import { listPositions, upsertPosition, deletePosition } from "../repositories/portfolio.js";
import { computePortfolioReview } from "../services/portfolioReview.js";
import { enrichPosition } from "../services/portfolioEnrich.js";
import { getPortfolioSnapshots } from "../services/portfolioSnapshot.js";

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

/** GET /api/portfolio/snapshots → 每日组合快照（M-1 净值曲线数据源，E9 每日 scheduler 任务落库）。 */
export async function handlePortfolioSnapshots(req, res) {
  try {
    sendOk(res, { snapshots: getPortfolioSnapshots(180) });
  } catch (error) {
    sendError(res, 500, error.message || "获取组合快照失败");
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
