/**
 * hkFinancialsRepository — 港股一手财报（HKEX 业绩公告 PDF 抽取）落库。
 *
 * 一行 = 一份业绩公告抽出的一期关键数字（绝对币值，非百万），
 * source_url 唯一：同一份公告重复摄取走 upsert 更新。
 */

import { getDb } from "../../db/index.js";

let ensured = false;

function ensureTable() {
  if (ensured) return;
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS hk_financials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    period_label TEXT,
    period_end TEXT,
    period_type TEXT,
    currency TEXT,
    unit_label TEXT,
    revenue REAL,
    revenue_prior REAL,
    gross_profit REAL,
    gross_profit_prior REAL,
    operating_income REAL,
    operating_income_prior REAL,
    net_income REAL,
    net_income_prior REAL,
    net_income_attributable REAL,
    eps REAL,
    operating_cash_flow REAL,
    cash_and_equivalents REAL,
    net_cash REAL,
    source_title TEXT,
    source_url TEXT UNIQUE,
    published_at TEXT,
    extracted_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_hk_financials_ticker ON hk_financials(ticker, period_end);`);
  ensured = true;
}

export function upsertHkFinancials(row) {
  ensureTable();
  const db = getDb();
  db.prepare(`
    INSERT INTO hk_financials (
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

export function getHkFinancials(ticker, limit = 4) {
  ensureTable();
  const db = getDb();
  return db.prepare(`
    SELECT * FROM hk_financials
    WHERE ticker = ?
    ORDER BY COALESCE(period_end, published_at) DESC
    LIMIT ?
  `).all(ticker, limit);
}

export function hasHkFinancialsForUrl(sourceUrl) {
  ensureTable();
  const db = getDb();
  return !!db.prepare("SELECT 1 FROM hk_financials WHERE source_url = ?").get(sourceUrl);
}
