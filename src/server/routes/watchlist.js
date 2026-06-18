/**
 * Watchlist routes — CRUD for research watchlist items.
 *
 * GET    /api/watchlist              → list all (with summary)
 * POST   /api/watchlist              → add item
 * GET    /api/watchlist/:id          → get one item
 * PATCH  /api/watchlist/:id          → update item
 * DELETE /api/watchlist/:id          → remove item
 * GET    /api/watchlist/summary      → discipline stats
 */

import { readJsonBody, sendOk, sendError } from "../utils/async.js";
import { listWatchlist, getWatchlistItem, addWatchlistItem, updateWatchlistItem, deleteWatchlistItem, getWatchlistSummary } from "../repositories/watchlistRepository.js";

export async function handleWatchlistList(req, res) {
  try {
    const items = listWatchlist();
    const summary = getWatchlistSummary();
    sendOk(res, { items, summary });
  } catch (error) {
    sendError(res, 500, error.message || "获取关注列表失败");
  }
}

export async function handleWatchlistAdd(req, res) {
  try {
    const body = await readJsonBody(req);
    const item = addWatchlistItem({
      ticker: body.ticker,
      reason: body.reason || "",
      costBasis: body.costBasis || null,
      shares: body.shares || null,
      status: body.status || "watch",
      notes: body.notes || "",
      reviewDate: body.reviewDate || null
    });
    sendOk(res, { item }, { created: true });
  } catch (error) {
    sendError(res, 500, error.message || "添加关注失败");
  }
}

export async function handleWatchlistGet(req, res, id) {
  try {
    if (!id) { sendError(res, 400, "缺少 id"); return; }
    const item = getWatchlistItem(id);
    if (!item) { sendError(res, 404, "未找到关注项"); return; }
    sendOk(res, { item });
  } catch (error) {
    sendError(res, 500, error.message || "获取关注项失败");
  }
}

export async function handleWatchlistUpdate(req, res, id) {
  try {
    if (!id) { sendError(res, 400, "缺少 id"); return; }
    const body = await readJsonBody(req);
    const item = updateWatchlistItem(id, body);
    if (!item) { sendError(res, 404, "未找到关注项"); return; }
    sendOk(res, { item });
  } catch (error) {
    sendError(res, 500, error.message || "更新关注项失败");
  }
}

export async function handleWatchlistDelete(req, res, id) {
  try {
    if (!id) { sendError(res, 400, "缺少 id"); return; }
    deleteWatchlistItem(id);
    sendOk(res, { deleted: true });
  } catch (error) {
    sendError(res, 500, error.message || "删除关注项失败");
  }
}
