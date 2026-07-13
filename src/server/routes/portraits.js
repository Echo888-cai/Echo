/**
 * Company portrait routes:
 *
 * GET    /api/company/profiles        → list saved portraits (sidebar)
 * GET    /api/company/profile?ticker= → get one portrait (with markdown + events)
 * DELETE /api/company/profile?ticker= → delete one portrait
 * GET    /api/company/review?ticker=  → R7 研究记分卡：该公司的快照复盘（Phase B）
 * GET    /api/research/scorecard      → R7 研究记分卡：全局汇总（Phase B）
 */

import { sendOk, sendError } from "../utils/async.js";
import { listCompanyProfiles, getCompanyProfile, deleteCompanyProfile, renderProfileMarkdown } from "../repositories/companyProfilesRepository.js";
import { listSnapshots, listSnapshotTickers } from "../repositories/researchSnapshotsRepository.js";
import { computeTickerScorecard, computeGlobalScorecard } from "@echo/domain";
import { getMarketSnapshot } from "../../marketData.js";
import { getEarningsCalendarRow } from "../repositories/earningsCalendarRepository.js";

const userId = (req) => req.echoUser?.id || "local";

export async function handleProfileList(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10));
    const profiles = listCompanyProfiles(limit, userId(req));
    sendOk(res, { profiles, count: profiles.length });
  } catch (error) {
    sendError(res, 500, error.message || "获取画像列表失败");
  }
}

export async function handleProfileGet(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const ticker = url.searchParams.get("ticker");
    if (!ticker) { sendError(res, 400, "缺少 ticker"); return; }
    const profile = getCompanyProfile(ticker, userId(req));
    if (!profile) { sendError(res, 404, "未找到该公司画像"); return; }
    // 总是现渲染：老库存的 profile_md 是旧格式，且时间线可能有 upsert 之外追加的事件。
    const markdown = renderProfileMarkdown(profile.ticker, profile, profile.events);
    sendOk(res, { profile, markdown });
  } catch (error) {
    sendError(res, 500, error.message || "获取画像失败");
  }
}

export async function handleProfileDelete(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const ticker = url.searchParams.get("ticker");
    if (!ticker) { sendError(res, 400, "缺少 ticker"); return; }
    const deleted = deleteCompanyProfile(ticker, userId(req));
    if (!deleted) { sendError(res, 404, "未找到该公司画像"); return; }
    sendOk(res, { deleted: true, ticker });
  } catch (error) {
    sendError(res, 500, error.message || "删除画像失败");
  }
}

/** R7 Phase B：单只票的研究复盘——历史判断快照 vs 现价。 */
export async function handleProfileReview(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const ticker = url.searchParams.get("ticker");
    if (!ticker) { sendError(res, 400, "缺少 ticker"); return; }
    const snapshots = listSnapshots(ticker, userId(req));
    let current = { price: null };
    try {
      const snap = await getMarketSnapshot(ticker);
      if (snap?.providerStatus === "ok" && snap.price != null) current = { price: snap.price, asOf: snap.asOf };
    } catch {
      // 行情源不可用时复盘仍可算（只是 priceNow 相关字段为 null），不阻断
    }
    let earningsRow = null;
    try { earningsRow = getEarningsCalendarRow(String(ticker).toUpperCase()); } catch { /* F-2 数据缺失不影响复盘主体 */ }
    const scorecard = computeTickerScorecard(snapshots, current, undefined, earningsRow);
    sendOk(res, { ticker: String(ticker).toUpperCase(), scorecard });
  } catch (error) {
    sendError(res, 500, error.message || "获取研究复盘失败");
  }
}

/** R7 Phase B：全局研究记分卡——跨全部有快照的公司汇总（设置页用）。 */
export async function handleResearchScorecard(req, res) {
  try {
    const uid = userId(req);
    const tickers = listSnapshotTickers(uid);
    const perTicker = await Promise.all(
      tickers.map(async ({ ticker }) => {
        const snapshots = listSnapshots(ticker, uid);
        let current = { price: null };
        try {
          const snap = await getMarketSnapshot(ticker);
          if (snap?.providerStatus === "ok" && snap.price != null) current = { price: snap.price };
        } catch { /* 单只票行情失败不影响其它票的汇总 */ }
        let earningsRow = null;
        try { earningsRow = getEarningsCalendarRow(String(ticker).toUpperCase()); } catch { /* F-2 数据缺失不影响该票汇总 */ }
        return { ticker, scorecard: computeTickerScorecard(snapshots, current, undefined, earningsRow) };
      })
    );
    const global = computeGlobalScorecard(perTicker);
    sendOk(res, { global, perTicker: perTicker.map((t) => ({ ticker: t.ticker, scorecard: t.scorecard })) });
  } catch (error) {
    sendError(res, 500, error.message || "获取研究记分卡失败");
  }
}
