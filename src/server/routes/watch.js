/**
 * Watch-desk routes:
 *
 * GET /api/watch/desk           → 盯盘台聚合（画像 + 事件 + 持仓 → 每家一张卡）
 *   query: slot=premarket|afterhours, tickers=AAPL,0700.HK (optional override),
 *          events=0 → fast 模式：跳过新闻/财报日历（慢源），先回价格与状态（前端两段式刷新）
 * GET /api/watch/stock?ticker=  → 单只股票的看盘台详情页数据（卡片 + 完整画像 + 基本面）
 *
 * 关注范围默认 = 研究过的公司（画像）∪ 持仓，按需计算（无常驻进程）。
 */

import { sendOk, sendError, readJsonBody } from "../utils/async.js";
import { buildWatchDesk, buildStockView, trackedUniverse } from "../services/watchDesk.js";
import { addToWatch, removeFromWatch } from "../repositories/watchlist.js";

const userId = (req) => req.echoUser?.id || "local";

export async function handleWatchDesk(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const slot = url.searchParams.get("slot") === "afterhours" ? "afterhours" : "premarket";
    const uid = userId(req);
    const companies = trackedUniverse(url.searchParams.get("tickers"), uid);

    if (!companies.length) {
      sendOk(res, {
        desk: { generatedAt: new Date().toISOString(), slot, cards: [], counts: { falsified: 0, atRisk: 0, intact: 0, total: 0 }, failures: [] }
      });
      return;
    }

    const withEvents = url.searchParams.get("events") !== "0";
    const desk = await buildWatchDesk(companies, { slot, events: withEvents, userId: uid });
    sendOk(res, { desk: { ...desk, partial: !withEvents } });
  } catch (error) {
    sendError(res, 500, error.message || "生成盯盘台失败");
  }
}

export async function handleWatchTrack(req, res) {
  try {
    const body = await readJsonBody(req);
    const ticker = (body.ticker || "").trim();
    if (!ticker) { sendError(res, 400, "缺少 ticker"); return; }
    addToWatch(ticker, body.name, userId(req));
    sendOk(res, { tracked: true, ticker });
  } catch (error) {
    sendError(res, 500, error.message || "添加关注失败");
  }
}

export async function handleWatchUntrack(req, res) {
  try {
    const body = await readJsonBody(req);
    const ticker = (body.ticker || "").trim();
    if (!ticker) { sendError(res, 400, "缺少 ticker"); return; }
    removeFromWatch(ticker, userId(req));
    sendOk(res, { untracked: true, ticker });
  } catch (error) {
    sendError(res, 500, error.message || "移除关注失败");
  }
}

export async function handleWatchStock(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const ticker = url.searchParams.get("ticker");
    if (!ticker) { sendError(res, 400, "缺少 ticker"); return; }
    const stock = await buildStockView(ticker, userId(req));
    sendOk(res, { stock });
  } catch (error) {
    sendError(res, 500, error.message || "生成个股看盘数据失败");
  }
}
