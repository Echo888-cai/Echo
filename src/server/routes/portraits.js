/**
 * Company portrait routes:
 *
 * GET    /api/company/profiles        → list saved portraits (sidebar)
 * GET    /api/company/profile?ticker= → get one portrait (with markdown + events)
 * DELETE /api/company/profile?ticker= → delete one portrait
 */

import { sendOk, sendError } from "../utils/async.js";
import { listCompanyProfiles, getCompanyProfile, deleteCompanyProfile, renderProfileMarkdown } from "../repositories/companyProfiles.js";

export async function handleProfileList(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const limit = Math.min(100, parseInt(url.searchParams.get("limit") || "50", 10));
    const profiles = listCompanyProfiles(limit);
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
    const profile = getCompanyProfile(ticker);
    if (!profile) { sendError(res, 404, "未找到该公司画像"); return; }
    const markdown = profile.profileMd || renderProfileMarkdown(profile.ticker, profile, profile.events);
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
    const deleted = deleteCompanyProfile(ticker);
    if (!deleted) { sendError(res, 404, "未找到该公司画像"); return; }
    sendOk(res, { deleted: true, ticker });
  } catch (error) {
    sendError(res, 500, error.message || "删除画像失败");
  }
}
