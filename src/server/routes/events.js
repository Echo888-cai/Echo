/**
 * Event-engine routes:
 *
 * GET /api/events/digest          → premarket/afterhours digest for tracked companies
 *   query: slot=premarket|afterhours, tickers=AAPL,0700.HK (optional override)
 *
 * "Tracked" = companies that already have a long-term portrait. If the caller
 * passes ?tickers=, those win. The digest is computed on demand (no daemon).
 */

import { sendOk, sendError } from "../utils/async.js";
import { buildDigest } from "../services/eventEngine.js";
import { listCompanyProfiles } from "../repositories/companyProfiles.js";
import { listPositions } from "../repositories/portfolio.js";
import { companyByTicker } from "../../data.js";

const userId = (req) => req.echoUser?.id || "local";

export async function handleEventsDigest(req, res) {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const slot = url.searchParams.get("slot") === "afterhours" ? "afterhours" : "premarket";
    const tickerParam = url.searchParams.get("tickers");

    let companies;
    if (tickerParam) {
      companies = tickerParam.split(",").map((t) => t.trim()).filter(Boolean).map((ticker) => {
        const c = companyByTicker(ticker);
        return { ticker, nameZh: c?.nameZh || ticker };
      });
    } else {
      // Default audience: companies the user researches (portrait) or holds (portfolio).
      const byTicker = new Map();
      const uid = userId(req);
      for (const p of listCompanyProfiles(30, uid)) byTicker.set(p.ticker, { ticker: p.ticker, nameZh: p.companyName });
      for (const pos of listPositions(uid)) if (!byTicker.has(pos.ticker)) byTicker.set(pos.ticker, { ticker: pos.ticker, nameZh: pos.companyName });
      companies = [...byTicker.values()];
    }

    if (!companies.length) {
      sendOk(res, { digest: { generatedAt: new Date().toISOString(), slot, events: [], groups: [], failures: [], counts: { high: 0, medium: 0, low: 0 }, summary: "还没有跟踪的公司。完成一轮研究后，这里会显示财报与重大新闻提醒。" }, tracked: 0 });
      return;
    }

    const digest = await buildDigest(companies, {}, { slot, userId: userId(req) });
    sendOk(res, { digest, tracked: companies.length });
  } catch (error) {
    sendError(res, 500, error.message || "生成事件 digest 失败");
  }
}
