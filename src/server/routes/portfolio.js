/**
 * Portfolio routes:
 *
 * GET    /api/portfolio          → list positions
 * DELETE /api/portfolio?ticker=  → remove a position
 *
 * Positions are recorded automatically from natural-language chat (cost / shares /
 * stop-loss / take-profit), so there is no manual create endpoint here.
 */

import { sendOk, sendError } from "../utils/async.js";
import { listPositions, deletePosition } from "../repositories/portfolio.js";

export async function handlePortfolioList(req, res) {
  try {
    sendOk(res, { positions: listPositions() });
  } catch (error) {
    sendError(res, 500, error.message || "获取持仓失败");
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
