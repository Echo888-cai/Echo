import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { portfolioSnapshots, portfolioSnapshotTotals } from "../schema/portfolio.js";
import { numberOrNull, numeric, withTenant } from "./context.js";

/**
 * 组合估值全程在 PostgreSQL NUMERIC 里完成（红线：金融计算不用二进制浮点）。
 * fxToUsd 传各币种对 USD 的汇率字符串（如 { HKD: "0.1281" }），USD 恒为 1。
 * 任一持仓缺价或缺汇率时由调用方按"断口"跳过，不插值、不回填。
 */
export async function computePortfolioValuationUsd(fxToUsd: Record<string, string>, userId = "local") {
  return withTenant(userId, async (tx) => {
    const fx = JSON.stringify({ USD: "1", ...fxToUsd });
    const priced = sql`
      with latest as (
        select distinct on (ticker) ticker, price
        from market_snapshots
        order by ticker, valid_time desc, id desc
      ), pos as (
        select p.ticker,
               p.shares::numeric as shares,
               p.avg_cost::numeric as avg_cost,
               case when p.ticker like '%.HK' then 'HKD'
                    when p.ticker like '%.SS' or p.ticker like '%.SZ' then 'CNY'
                    else 'USD' end as currency,
               l.price
        from portfolio_positions p
        left join latest l on l.ticker = p.ticker
        where p.user_id = ${userId} and p.shares is not null
      ), priced as (
        select pos.*, (${fx}::jsonb ->> pos.currency)::numeric as fx from pos
      )`;
    const [summary]: any[] = await tx.execute(sql`${priced}
      select count(*)::int as position_count,
             count(*) filter (where price is null)::int as missing_price,
             count(*) filter (where fx is null)::int as missing_fx,
             sum(price * shares * fx)::text as total_value_usd,
             sum(coalesce(avg_cost, 0) * shares * fx)::text as total_cost_usd,
             (sum(price * shares * fx) - sum(coalesce(avg_cost, 0) * shares * fx))::text as total_pnl_usd
      from priced`);
    const currencyTotals: any[] = await tx.execute(sql`${priced}
      select currency, sum(price * shares)::text as market_value
      from priced where price is not null
      group by currency order by currency`);
    return {
      positionCount: Number(summary?.position_count || 0),
      missingPrice: Number(summary?.missing_price || 0),
      missingFx: Number(summary?.missing_fx || 0),
      totalValueUsd: summary?.total_value_usd ?? null,
      totalCostUsd: summary?.total_cost_usd ?? null,
      totalPnlUsd: summary?.total_pnl_usd ?? null,
      totals: currencyTotals.map((row) => ({ currency: row.currency, marketValue: row.market_value }))
    };
  });
}

export async function upsertSnapshot(snapshot: any, userId = "local") {
  await withTenant(userId, async (tx) => {
    const values = { userId, validTime: snapshot.date, totalValueUsd: numeric(snapshot.totalValueUsd), totalCostUsd: numeric(snapshot.totalCostUsd),
      totalPnlUsd: numeric(snapshot.totalPnlUsd), positionCount: snapshot.positionCount, knowledgeTime: new Date() };
    await tx.insert(portfolioSnapshots).values(values).onConflictDoUpdate({ target: [portfolioSnapshots.userId, portfolioSnapshots.validTime], set: values });
    await tx.delete(portfolioSnapshotTotals).where(and(eq(portfolioSnapshotTotals.userId, userId), eq(portfolioSnapshotTotals.snapshotValidTime, snapshot.date)));
    if (snapshot.totals?.length) await tx.insert(portfolioSnapshotTotals).values(snapshot.totals.map((item: any) => ({
      userId, snapshotValidTime: snapshot.date, currency: item.currency, marketValue: numeric(item.marketValue)!
    })));
  });
}

export async function listSnapshots(limit = 180, userId = "local") {
  return withTenant(userId, async (tx) => {
    const rows = (await tx.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.userId, userId))
      .orderBy(desc(portfolioSnapshots.validTime)).limit(limit)).reverse();
    if (!rows.length) return [];
    const dates = rows.map((row) => row.validTime);
    const totals = await tx.select().from(portfolioSnapshotTotals).where(and(eq(portfolioSnapshotTotals.userId, userId), inArray(portfolioSnapshotTotals.snapshotValidTime, dates)));
    return rows.map((row) => ({ date: row.validTime, totalValueUsd: numberOrNull(row.totalValueUsd), totalCostUsd: numberOrNull(row.totalCostUsd),
      totalPnlUsd: numberOrNull(row.totalPnlUsd), positionCount: row.positionCount,
      totals: totals.filter((item) => item.snapshotValidTime === row.validTime).map((item) => ({ currency: item.currency, marketValue: numberOrNull(item.marketValue) })) }));
  });
}
