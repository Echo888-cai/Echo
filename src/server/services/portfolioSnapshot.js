/**
 * portfolioSnapshot — 每日组合快照（M-1，PLAN v4 E9）：把当天的组合折算成一个近似 USD
 * 数字并落库，喂持仓页的净值曲线，同时是数据护城河的自沉淀时间序列（跑得越久越值钱）。
 *
 * 刻意的边界：
 * - 折算用 portfolioReview.js 同一份 FX_TO_USD 近似常量，两处数字不会对不上（PLAN v4 红线 11）。
 * - 没有任何一笔持仓能核到现价时，totalValueUsd 记 null 而不是 0——0 意味着"组合归零"，
 *   跟"数据缺失"是两回事（红线 5 的延伸）。
 * - 快照只在任务真正跑过的那天存在；不存在的日期就是断口，前端不插值不回填（红线 15）。
 */

import { beijingDate } from "../utils/time.js";
import { listPositions } from "../repositories/portfolio.js";
import { enrichPosition } from "./portfolioEnrich.js";
import { FX_TO_USD } from "./portfolioReview.js";
import { upsertSnapshot, listSnapshots } from "../repositories/portfolioSnapshots.js";

const usdValue = (p) => (p.marketValue != null ? p.marketValue * (FX_TO_USD[p.currency] || 1) : null);
const usdCost = (p) => (p.costValue != null ? p.costValue * (FX_TO_USD[p.currency] || 1) : null);

/** 纯函数：已丰富化持仓 → 当天快照总量。不打网络、不读库，好测。 */
export function computeSnapshotTotals(enriched = []) {
  const priced = enriched.filter((p) => usdValue(p) != null);
  const totalValueUsd = priced.length ? Math.round(priced.reduce((s, p) => s + usdValue(p), 0)) : null;
  const totalCostUsd = priced.length ? Math.round(priced.reduce((s, p) => s + (usdCost(p) || 0), 0)) : null;
  const totalPnlUsd = totalValueUsd != null && totalCostUsd != null ? totalValueUsd - totalCostUsd : null;

  const byCurrency = new Map();
  for (const p of enriched) {
    if (p.marketValue == null) continue;
    const cur = p.currency || "USD";
    const acc = byCurrency.get(cur) || { currency: cur, marketValue: 0 };
    acc.marketValue += p.marketValue;
    byCurrency.set(cur, acc);
  }

  return {
    totalValueUsd,
    totalCostUsd,
    totalPnlUsd,
    positionCount: enriched.length,
    totals: [...byCurrency.values()].map((t) => ({ currency: t.currency, marketValue: Math.round(t.marketValue) }))
  };
}

/** scheduler 每日任务：拉现价 → 丰富化 → 算总量 → upsert 当天一行（幂等）。 */
export async function recordDailySnapshot() {
  const positions = listPositions();
  if (!positions.length) return "无持仓，跳过快照";
  const enriched = await Promise.all(positions.map(enrichPosition));
  const totals = computeSnapshotTotals(enriched);
  const date = beijingDate();
  upsertSnapshot({ date, ...totals });
  return `${date} 组合快照已记录（${totals.positionCount} 笔持仓${totals.totalValueUsd != null ? `，≈$${totals.totalValueUsd}` : "，现价未核到"}）`;
}

export function getPortfolioSnapshots(limit = 180) {
  return listSnapshots(limit);
}
