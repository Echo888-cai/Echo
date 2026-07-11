/**
 * cnFinancialsRepository — A 股一手财报（巨潮资讯网业绩公告 PDF 抽取）落库。
 *
 * 结构与 hkFinancialsRepository 完全对称：一行 = 一份业绩公告抽出的一期关键数字
 * （绝对币值，非万/亿），source_url 唯一：同一份公告重复摄取走 upsert 更新。
 * 与港股的差异只在数据源（巨潮资讯网 vs HKEX）和币种（几乎全是 CNY），
 * 不需要 HK 那套 CNY→HKD 换算层。
 */

import { getDb } from "../../db/index.js";

export function upsertCnFinancials(row) {
  const db = getDb();
  db.prepare(`
    INSERT INTO cn_financials (
      ticker, period_label, period_end, period_type, currency, unit_label,
      revenue, revenue_prior, gross_profit, gross_profit_prior,
      operating_income, operating_income_prior, net_income, net_income_prior,
      net_income_attributable, eps, operating_cash_flow, cash_and_equivalents, net_cash,
      source_title, source_url, published_at, extracted_at
    ) VALUES (
      @ticker, @periodLabel, @periodEnd, @periodType, @currency, @unitLabel,
      @revenue, @revenuePrior, @grossProfit, @grossProfitPrior,
      @operatingIncome, @operatingIncomePrior, @netIncome, @netIncomePrior,
      @netIncomeAttributable, @eps, @operatingCashFlow, @cashAndEquivalents, @netCash,
      @sourceTitle, @sourceUrl, @publishedAt, datetime('now')
    )
    ON CONFLICT(source_url) DO UPDATE SET
      period_label = excluded.period_label,
      period_end = excluded.period_end,
      period_type = excluded.period_type,
      currency = excluded.currency,
      unit_label = excluded.unit_label,
      revenue = excluded.revenue,
      revenue_prior = excluded.revenue_prior,
      gross_profit = excluded.gross_profit,
      gross_profit_prior = excluded.gross_profit_prior,
      operating_income = excluded.operating_income,
      operating_income_prior = excluded.operating_income_prior,
      net_income = excluded.net_income,
      net_income_prior = excluded.net_income_prior,
      net_income_attributable = excluded.net_income_attributable,
      eps = excluded.eps,
      operating_cash_flow = excluded.operating_cash_flow,
      cash_and_equivalents = excluded.cash_and_equivalents,
      net_cash = excluded.net_cash,
      source_title = excluded.source_title,
      published_at = excluded.published_at,
      extracted_at = datetime('now')
  `).run({
    ticker: row.ticker,
    periodLabel: row.periodLabel ?? null,
    periodEnd: row.periodEnd ?? null,
    periodType: row.periodType ?? null,
    currency: row.currency ?? null,
    unitLabel: row.unitLabel ?? null,
    revenue: row.revenue ?? null,
    revenuePrior: row.revenuePrior ?? null,
    grossProfit: row.grossProfit ?? null,
    grossProfitPrior: row.grossProfitPrior ?? null,
    operatingIncome: row.operatingIncome ?? null,
    operatingIncomePrior: row.operatingIncomePrior ?? null,
    netIncome: row.netIncome ?? null,
    netIncomePrior: row.netIncomePrior ?? null,
    netIncomeAttributable: row.netIncomeAttributable ?? null,
    eps: row.eps ?? null,
    operatingCashFlow: row.operatingCashFlow ?? null,
    cashAndEquivalents: row.cashAndEquivalents ?? null,
    netCash: row.netCash ?? null,
    sourceTitle: row.sourceTitle ?? null,
    sourceUrl: row.sourceUrl,
    publishedAt: row.publishedAt ?? null
  });
}

export function getCnFinancials(ticker, limit = 4) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM cn_financials
    WHERE ticker = ?
    ORDER BY COALESCE(period_end, published_at) DESC
    LIMIT ?
  `).all(ticker, limit);
}

export function hasCnFinancialsForUrl(sourceUrl) {
  const db = getDb();
  return !!db.prepare("SELECT 1 FROM cn_financials WHERE source_url = ?").get(sourceUrl);
}

// ─── 摄取留痕：同 hk_filing_ingest_log 的角色，供 scripts/cn-coverage.js 增量扫描 +
// 健康面板覆盖率统计用。

export function upsertCnFilingIngestLog({ ticker, status, detail, announcementsFound = 0, ingestedCount = 0 }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO cn_filing_ingest_log (ticker, status, detail, announcements_found, ingested_count, checked_at)
    VALUES (@ticker, @status, @detail, @announcementsFound, @ingestedCount, datetime('now'))
    ON CONFLICT(ticker) DO UPDATE SET
      status = excluded.status,
      detail = excluded.detail,
      announcements_found = excluded.announcements_found,
      ingested_count = excluded.ingested_count,
      checked_at = excluded.checked_at
  `).run({ ticker, status, detail: detail ?? null, announcementsFound, ingestedCount });
}

/** A 股一手财报覆盖率：seed universe 里多少有数据、多少检查过、失败清单（最近 50 条）。 */
export function getCnFilingCoverage() {
  const db = getDb();
  const totalCn = db.prepare(`SELECT COUNT(*) as n FROM companies WHERE ticker LIKE '%.SS' OR ticker LIKE '%.SZ'`).get().n;
  const withFirstParty = db.prepare(`SELECT COUNT(DISTINCT ticker) as n FROM cn_financials`).get().n;
  const checked = db.prepare(`SELECT COUNT(*) as n FROM cn_filing_ingest_log`).get().n;
  const failed = db.prepare(`
    SELECT l.ticker, c.name_zh as company_name, l.status, l.detail, l.checked_at
    FROM cn_filing_ingest_log l
    LEFT JOIN companies c ON c.ticker = l.ticker
    WHERE l.status != 'ok'
    ORDER BY l.checked_at DESC
    LIMIT 50
  `).all();
  return { totalCn, withFirstParty, checked, uncheckedCount: Math.max(0, totalCn - checked), failed };
}
