/**
 * 港股一手财报路由（P7）。
 *
 * GET  /api/hk-financials?ticker=0700.HK       → hk_financials 已入库行
 * POST /api/hk-financials/ingest?ticker=0700   → 同步摄取最近 N 份业绩公告（含下载+抽取，可能 10-60s）
 */

import { sendOk, sendError } from "../utils/async.js";
import { getHkFinancials } from "../repositories/hkFinancialsRepository.js";
import { ingestHkFinancials } from "../services/hkFilingsPipeline.js";
import { normalizeTicker } from "../../data.js";

export async function handleHkFinancialsList(req, res) {
  const url = new URL(req.url, "http://localhost");
  const ticker = url.searchParams.get("ticker");
  if (!ticker) return sendError(res, 400, "缺少 ticker 参数");
  try {
    const rows = getHkFinancials(normalizeTicker(ticker), Number(url.searchParams.get("limit")) || 6);
    return sendOk(res, { ticker: normalizeTicker(ticker), rows });
  } catch (error) {
    return sendError(res, 500, error.message || "读取港股一手财报失败");
  }
}

export async function handleHkFinancialsIngest(req, res) {
  const url = new URL(req.url, "http://localhost");
  const ticker = url.searchParams.get("ticker");
  if (!ticker) return sendError(res, 400, "缺少 ticker 参数");
  try {
    const result = await ingestHkFinancials(normalizeTicker(ticker), {
      limit: Number(url.searchParams.get("limit")) || 3,
      force: url.searchParams.get("force") === "1"
    });
    return sendOk(res, result);
  } catch (error) {
    return sendError(res, 500, error.message || "港股业绩公告摄取失败");
  }
}
