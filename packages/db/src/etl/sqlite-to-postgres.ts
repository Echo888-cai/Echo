/**
 * sqlite-to-postgres.ts — R-1 ETL proof: read the running app's luvio.db (SQLite,
 * read-only) and load it into the local `echo_dev` Postgres database defined by the
 * Drizzle schema in ../schema/*.
 *
 * Idempotent: every table is upserted (ON CONFLICT DO UPDATE on the primary key, or
 * DO NOTHING for pure append-only logs), so re-running this script is safe.
 *
 * This script does NOT modify src/db/** or luvio.db — it opens the SQLite file in
 * readonly mode and only writes to the separate Postgres database.
 */
import Database from "better-sqlite3";
import { createDb } from "../index.js";
import * as schema from "../schema/index.js";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";

const SQLITE_PATH = process.env.LUVIO_DB_PATH || fileURLToPath(new URL("../../../../luvio.db", import.meta.url));

const { db, client } = createDb();
const sqliteDb = new Database(SQLITE_PATH, { readonly: true });

// ─── helpers ──────────────────────────────────────────────────────────────

/** SQLite datetime('now') strings ("YYYY-MM-DD HH:MM:SS", naive UTC) and provider
 * timestamps (already full ISO-8601, sometimes with a numeric offset like
 * "+08:00" — e.g. market_snapshots.as_of from Tencent Finance) -> JS Date.
 * Only naive strings (no zone info at all) get a "Z" appended; anything that
 * already carries "Z" or a +HH:MM/-HH:MM offset is parsed as-is. */
function toTimestamp(value: unknown): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const hasZone = /Z$|[+-]\d{2}:\d{2}$/.test(s);
  if (s.includes("T")) {
    const d = new Date(hasZone ? s : `${s}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(hasZone ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pass-through for TEXT date-only columns (period_end, trade_date, snapshot_date, ...) —
 * these are already "YYYY-MM-DD" and Postgres `date` / `text` columns accept the string
 * as-is; no Date object round-trip needed (avoids TZ-shift bugs on date-only values). */
function toDateText(value: unknown): string | null {
  return value == null ? null : String(value);
}

function toBool(value: unknown): boolean {
  return !!value;
}

function parseJsonArray(value: unknown): string[] | null {
  if (value == null) return null;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseJson(value: unknown): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

/** For `numeric()` columns — drizzle's numeric() column type is string-mode by
 * default (to avoid float precision loss), so REAL values from SQLite are
 * stringified rather than passed through as JS numbers. */
function num(value: unknown): string | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : null;
}

function allRows<T = any>(table: string): T[] {
  return sqliteDb.prepare(`SELECT * FROM ${table}`).all() as T[];
}

const report: { table: string; sqliteCount: number; postgresCount: number }[] = [];

async function loadCount(pgTable: any): Promise<number> {
  const [{ count }] = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::int AS count FROM ${pgTable}`);
  return Number(count);
}

async function run() {
  // ── companies ────────────────────────────────────────────────────────
  {
    const rows = allRows("companies");
    if (rows.length) {
      await db
        .insert(schema.companies)
        .values(
          rows.map((r: any) => ({
            ticker: r.ticker,
            nameZh: r.name_zh,
            nameEn: r.name_en,
            sector: r.sector,
            industry: r.industry,
            listingStatus: r.listing_status,
            exchange: r.exchange,
            currency: r.currency,
            marketCapCategory: r.market_cap_category,
            isHsi: toBool(r.is_hsi),
            createdAt: toTimestamp(r.created_at) || new Date(),
            updatedAt: toTimestamp(r.updated_at) || new Date()
          }))
        )
        .onConflictDoUpdate({
          target: schema.companies.ticker,
          set: {
            nameZh: sql`excluded.name_zh`,
            nameEn: sql`excluded.name_en`,
            sector: sql`excluded.sector`,
            industry: sql`excluded.industry`,
            listingStatus: sql`excluded.listing_status`,
            exchange: sql`excluded.exchange`,
            currency: sql`excluded.currency`,
            marketCapCategory: sql`excluded.market_cap_category`,
            isHsi: sql`excluded.is_hsi`,
            updatedAt: sql`excluded.updated_at`
          }
        });
    }
    report.push({ table: "companies", sqliteCount: rows.length, postgresCount: await loadCount(schema.companies) });
  }

  // ── company_details ──────────────────────────────────────────────────
  {
    const rows = allRows("company_details");
    if (rows.length) {
      await db
        .insert(schema.companyDetails)
        .values(
          rows.map((r: any) => ({
            ticker: r.ticker,
            aliases: parseJsonArray(r.aliases),
            price: r.price == null ? null : String(r.price),
            marketCap: r.market_cap,
            week52Range: r.week_52_range,
            dividendYield: r.dividend_yield,
            pe: r.pe,
            pb: r.pb,
            ps: r.ps,
            latestReport: r.latest_report,
            status: r.status,
            statusTone: r.status_tone,
            summary: parseJsonArray(r.summary),
            businessModel: parseJsonArray(r.business_model),
            metrics: parseJsonArray(r.metrics),
            moat: parseJsonArray(r.moat),
            management: parseJsonArray(r.management),
            risks: parseJsonArray(r.risks),
            bullCase: parseJsonArray(r.bull_case),
            bearCase: parseJsonArray(r.bear_case),
            monitors: parseJsonArray(r.monitors),
            officialSources: parseJsonArray(r.official_sources),
            validTime: new Date(),
            knowledgeTime: new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.companyDetails.ticker });
    }
    report.push({ table: "company_details", sqliteCount: rows.length, postgresCount: await loadCount(schema.companyDetails) });
  }

  // ── market_snapshots (append-only log; DO NOTHING keyed on id) ───────
  {
    const rows = allRows("market_snapshots");
    if (rows.length) {
      await db
        .insert(schema.marketSnapshots)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            ticker: r.ticker,
            price: num(r.price),
            previousClose: num(r.previous_close),
            change: num(r.change),
            changePercent: num(r.change_percent),
            open: num(r.open),
            high: num(r.high),
            low: num(r.low),
            volume: num(r.volume),
            marketCap: num(r.market_cap),
            pe: num(r.pe),
            dividendYield: num(r.dividend_yield),
            week52High: num(r.week_52_high),
            week52Low: num(r.week_52_low),
            source: r.source,
            validTime: toTimestamp(r.as_of) || new Date(),
            knowledgeTime: toTimestamp(r.created_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.marketSnapshots.id });
    }
    report.push({ table: "market_snapshots", sqliteCount: rows.length, postgresCount: await loadCount(schema.marketSnapshots) });
  }

  // ── users / invite_codes / auth_sessions ─────────────────────────────
  {
    const rows = allRows("users");
    if (rows.length) {
      await db
        .insert(schema.users)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            username: r.username,
            passHash: r.pass_hash,
            displayName: r.display_name,
            role: r.role,
            createdAt: toTimestamp(r.created_at) || new Date(),
            lastLoginAt: toTimestamp(r.last_login_at)
          }))
        )
        .onConflictDoNothing({ target: schema.users.id });
    }
    report.push({ table: "users", sqliteCount: rows.length, postgresCount: await loadCount(schema.users) });
  }
  {
    const rows = allRows("invite_codes");
    if (rows.length) {
      await db
        .insert(schema.inviteCodes)
        .values(
          rows.map((r: any) => ({
            code: r.code,
            note: r.note,
            createdBy: r.created_by,
            createdAt: toTimestamp(r.created_at) || new Date(),
            usedBy: r.used_by,
            usedAt: toTimestamp(r.used_at)
          }))
        )
        .onConflictDoNothing({ target: schema.inviteCodes.code });
    }
    report.push({ table: "invite_codes", sqliteCount: rows.length, postgresCount: await loadCount(schema.inviteCodes) });
  }
  {
    const rows = allRows("auth_sessions");
    if (rows.length) {
      await db
        .insert(schema.authSessions)
        .values(
          rows.map((r: any) => ({
            tokenHash: r.token_hash,
            userId: r.user_id,
            createdAt: toTimestamp(r.created_at) || new Date(),
            expiresAt: toTimestamp(r.expires_at) || new Date(),
            lastSeenAt: toTimestamp(r.last_seen_at)
          }))
        )
        .onConflictDoNothing({ target: schema.authSessions.tokenHash });
    }
    report.push({ table: "auth_sessions", sqliteCount: rows.length, postgresCount: await loadCount(schema.authSessions) });
  }

  // ── research_sessions ────────────────────────────────────────────────
  {
    const rows = allRows("research_sessions");
    if (rows.length) {
      await db
        .insert(schema.researchSessions)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            userId: r.user_id || "local",
            ticker: r.ticker,
            title: r.title,
            question: r.question,
            conversationId: r.conversation_id,
            status: r.status,
            reportMarkdown: r.report_markdown,
            rating: r.rating,
            confidence: r.confidence,
            decisionPanel: parseJson(r.decision_panel),
            fullResearch: r.full_research,
            dataSources: parseJson(r.data_sources),
            threadJson: parseJson(r.thread_json),
            turnCount: r.turn_count,
            createdAt: toTimestamp(r.created_at) || new Date(),
            updatedAt: toTimestamp(r.updated_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.researchSessions.id });
    }
    report.push({ table: "research_sessions", sqliteCount: rows.length, postgresCount: await loadCount(schema.researchSessions) });
  }

  // ── company_profiles ─────────────────────────────────────────────────
  {
    const rows = allRows("company_profiles");
    if (rows.length) {
      await db
        .insert(schema.companyProfiles)
        .values(
          rows.map((r: any) => {
            const valuation = parseJson(r.valuation_json) as any;
            return {
              userId: r.user_id || "local",
              ticker: r.ticker,
              companyName: r.company_name,
              thesis: r.thesis,
              researchStatus: r.research_status,
              confidence: r.confidence,
              bull: parseJsonArray(r.bull_json),
              bear: parseJsonArray(r.bear_json),
              monitors: parseJsonArray(r.monitors_json),
              falsifiers: parseJsonArray(r.falsifiers_json),
              valuationMethod: valuation?.method ?? null,
              valuationBear: valuation?.bear != null ? String(valuation.bear) : null,
              valuationBase: valuation?.base != null ? String(valuation.base) : null,
              valuationBull: valuation?.bull != null ? String(valuation.bull) : null,
              valuationCurrentPrice: valuation?.currentPrice != null ? String(valuation.currentPrice) : null,
              profileMd: r.profile_md,
              turnCount: r.turn_count || 0,
              createdAt: toTimestamp(r.created_at) || new Date(),
              updatedAt: toTimestamp(r.updated_at) || new Date()
            };
          })
        )
        .onConflictDoNothing({ target: [schema.companyProfiles.userId, schema.companyProfiles.ticker] });
    }
    report.push({ table: "company_profiles", sqliteCount: rows.length, postgresCount: await loadCount(schema.companyProfiles) });
  }

  // ── profile_events ───────────────────────────────────────────────────
  {
    const rows = allRows("profile_events");
    if (rows.length) {
      await db
        .insert(schema.profileEvents)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            userId: r.user_id || "local",
            ticker: r.ticker,
            date: r.date,
            kind: r.kind,
            summary: r.summary,
            rationale: r.rationale,
            evidenceJson: parseJson(r.evidence_json),
            sessionId: r.session_id,
            createdAt: toTimestamp(r.created_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.profileEvents.id });
    }
    report.push({ table: "profile_events", sqliteCount: rows.length, postgresCount: await loadCount(schema.profileEvents) });
  }

  // ── research_snapshots ───────────────────────────────────────────────
  {
    const rows = allRows("research_snapshots");
    if (rows.length) {
      await db
        .insert(schema.researchSnapshots)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            userId: r.user_id || "local",
            ticker: r.ticker,
            validTime: toDateText(r.snapshot_date)!,
            thesis: r.thesis,
            valuationPosition: r.valuation_position,
            valuationBear: num(r.valuation_bear),
            valuationBase: num(r.valuation_base),
            valuationBull: num(r.valuation_bull),
            valuationCurrency: r.valuation_currency,
            priceAtSnapshot: num(r.price_at_snapshot),
            falsifiers: parseJsonArray(r.falsifiers_json),
            sessionId: r.session_id,
            knowledgeTime: toTimestamp(r.created_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.researchSnapshots.id });
    }
    report.push({ table: "research_snapshots", sqliteCount: rows.length, postgresCount: await loadCount(schema.researchSnapshots) });
  }

  // ── portfolio_positions ──────────────────────────────────────────────
  {
    const rows = allRows("portfolio_positions");
    if (rows.length) {
      await db
        .insert(schema.portfolioPositions)
        .values(
          rows.map((r: any) => ({
            userId: r.user_id || "local",
            ticker: r.ticker,
            companyName: r.company_name,
            shares: num(r.shares),
            avgCost: num(r.avg_cost),
            stopLoss: num(r.stop_loss),
            takeProfit: num(r.take_profit),
            note: r.note,
            createdAt: toTimestamp(r.created_at) || new Date(),
            updatedAt: toTimestamp(r.updated_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: [schema.portfolioPositions.userId, schema.portfolioPositions.ticker] });
    }
    report.push({ table: "portfolio_positions", sqliteCount: rows.length, postgresCount: await loadCount(schema.portfolioPositions) });
  }

  // ── watchlist_prefs ──────────────────────────────────────────────────
  {
    const rows = allRows("watchlist_prefs");
    if (rows.length) {
      await db
        .insert(schema.watchlistPrefs)
        .values(
          rows.map((r: any) => ({
            userId: r.user_id || "local",
            ticker: r.ticker,
            companyName: r.company_name,
            mode: r.mode,
            createdAt: toTimestamp(r.created_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: [schema.watchlistPrefs.userId, schema.watchlistPrefs.ticker] });
    }
    report.push({ table: "watchlist_prefs", sqliteCount: rows.length, postgresCount: await loadCount(schema.watchlistPrefs) });
  }

  // ── watch_rules ──────────────────────────────────────────────────────
  {
    const rows = allRows("watch_rules");
    if (rows.length) {
      await db
        .insert(schema.watchRules)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            userId: r.user_id || "local",
            ticker: r.ticker,
            kind: r.kind,
            threshold: num(r.threshold)!,
            metric: r.metric,
            label: r.label,
            source: r.source,
            sessionId: r.session_id,
            active: toBool(r.active),
            createdAt: toTimestamp(r.created_at) || new Date(),
            lastTriggeredAt: toTimestamp(r.last_triggered_at)
          }))
        )
        .onConflictDoNothing({ target: schema.watchRules.id });
    }
    report.push({ table: "watch_rules", sqliteCount: rows.length, postgresCount: await loadCount(schema.watchRules) });
  }

  // ── portfolio_snapshots (+ totals_json -> portfolio_snapshot_totals child) ──
  {
    const rows = allRows("portfolio_snapshots");
    if (rows.length) {
      await db
        .insert(schema.portfolioSnapshots)
        .values(
          rows.map((r: any) => ({
            userId: r.user_id || "local",
            validTime: toDateText(r.snapshot_date)!,
            totalValueUsd: num(r.total_value_usd),
            totalCostUsd: num(r.total_cost_usd),
            totalPnlUsd: num(r.total_pnl_usd),
            positionCount: r.position_count,
            knowledgeTime: toTimestamp(r.created_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: [schema.portfolioSnapshots.userId, schema.portfolioSnapshots.validTime] });

      const totalsRows = rows.flatMap((r: any) => {
        const totals = parseJson(r.totals_json) as Array<{ currency: string; marketValue: number }> | null;
        if (!Array.isArray(totals)) return [];
        return totals.map((t) => ({
          userId: r.user_id || "local",
          snapshotValidTime: toDateText(r.snapshot_date)!,
          currency: t.currency,
          marketValue: num(t.marketValue) ?? "0"
        }));
      });
      if (totalsRows.length) {
        await db
          .insert(schema.portfolioSnapshotTotals)
          .values(totalsRows)
          .onConflictDoNothing({
            target: [schema.portfolioSnapshotTotals.userId, schema.portfolioSnapshotTotals.snapshotValidTime, schema.portfolioSnapshotTotals.currency]
          });
      }
    }
    report.push({ table: "portfolio_snapshots", sqliteCount: rows.length, postgresCount: await loadCount(schema.portfolioSnapshots) });
  }

  // ── notifications ────────────────────────────────────────────────────
  {
    const rows = allRows("notifications");
    if (rows.length) {
      await db
        .insert(schema.notifications)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            userId: r.user_id || "local",
            kind: r.kind,
            title: r.title,
            body: r.body,
            ticker: r.ticker,
            payload: parseJson(r.payload),
            dedupeKey: r.dedupe_key,
            createdAt: toTimestamp(r.created_at) || new Date(),
            readAt: toTimestamp(r.read_at)
          }))
        )
        .onConflictDoNothing({ target: schema.notifications.id });
    }
    report.push({ table: "notifications", sqliteCount: rows.length, postgresCount: await loadCount(schema.notifications) });
  }

  // ── hk_financials / cn_financials ───────────────────────────────────
  for (const [sqliteTable, pgTable] of [
    ["hk_financials", schema.hkFinancials],
    ["cn_financials", schema.cnFinancials]
  ] as const) {
    const rows = allRows(sqliteTable);
    if (rows.length) {
      await db
        .insert(pgTable)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            ticker: r.ticker,
            periodLabel: r.period_label,
            validTime: toDateText(r.period_end),
            periodType: r.period_type,
            currency: r.currency,
            unitLabel: r.unit_label,
            revenue: num(r.revenue),
            revenuePrior: num(r.revenue_prior),
            grossProfit: num(r.gross_profit),
            grossProfitPrior: num(r.gross_profit_prior),
            operatingIncome: num(r.operating_income),
            operatingIncomePrior: num(r.operating_income_prior),
            netIncome: num(r.net_income),
            netIncomePrior: num(r.net_income_prior),
            netIncomeAttributable: num(r.net_income_attributable),
            eps: num(r.eps),
            operatingCashFlow: num(r.operating_cash_flow),
            cashAndEquivalents: num(r.cash_and_equivalents),
            netCash: num(r.net_cash),
            sourceTitle: r.source_title,
            sourceUrl: r.source_url,
            publishedAt: toTimestamp(r.published_at),
            knowledgeTime: toTimestamp(r.extracted_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: (pgTable as any).id });
    }
    report.push({ table: sqliteTable, sqliteCount: rows.length, postgresCount: await loadCount(pgTable) });
  }

  // ── hk_filing_ingest_log / cn_filing_ingest_log ─────────────────────
  for (const [sqliteTable, pgTable] of [
    ["hk_filing_ingest_log", schema.hkFilingIngestLog],
    ["cn_filing_ingest_log", schema.cnFilingIngestLog]
  ] as const) {
    const rows = allRows(sqliteTable);
    if (rows.length) {
      await db
        .insert(pgTable)
        .values(
          rows.map((r: any) => ({
            ticker: r.ticker,
            status: r.status,
            detail: r.detail,
            announcementsFound: r.announcements_found,
            ingestedCount: r.ingested_count,
            validTime: toTimestamp(r.checked_at) || new Date(),
            knowledgeTime: toTimestamp(r.checked_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: (pgTable as any).ticker });
    }
    report.push({ table: sqliteTable, sqliteCount: rows.length, postgresCount: await loadCount(pgTable) });
  }

  // ── earnings_calendar ────────────────────────────────────────────────
  {
    const rows = allRows("earnings_calendar");
    if (rows.length) {
      await db
        .insert(schema.earningsCalendar)
        .values(
          rows.map((r: any) => ({
            ticker: r.ticker,
            nextDate: r.next_date,
            quarter: r.quarter,
            year: r.year,
            epsEstimate: num(r.eps_estimate),
            revenueEstimate: num(r.revenue_estimate),
            source: r.source,
            providerStatus: r.provider_status,
            detail: r.detail,
            lastDate: r.last_date,
            lastQuarter: r.last_quarter,
            lastYear: r.last_year,
            lastEpsEstimate: num(r.last_eps_estimate),
            lastEpsActual: num(r.last_eps_actual),
            lastRevenueEstimate: num(r.last_revenue_estimate),
            lastRevenueActual: num(r.last_revenue_actual),
            lastEpsSurprisePct: num(r.last_eps_surprise_pct),
            lastRevenueSurprisePct: num(r.last_revenue_surprise_pct),
            validTime: r.last_date,
            knowledgeTime: toTimestamp(r.fetched_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.earningsCalendar.ticker });
    }
    report.push({ table: "earnings_calendar", sqliteCount: rows.length, postgresCount: await loadCount(schema.earningsCalendar) });
  }

  // ── comp_peers ───────────────────────────────────────────────────────
  {
    const rows = allRows("comp_peers");
    if (rows.length) {
      await db
        .insert(schema.compPeers)
        .values(
          rows.map((r: any) => ({
            ticker: r.ticker,
            stage: r.stage,
            peers: parseJson(r.peers_json),
            anchor: parseJson(r.anchor_json),
            providerStatus: r.provider_status,
            detail: r.detail,
            partial: toBool(r.partial),
            validTime: toTimestamp(r.fetched_at) || new Date(),
            knowledgeTime: toTimestamp(r.fetched_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.compPeers.ticker });
    }
    report.push({ table: "comp_peers", sqliteCount: rows.length, postgresCount: await loadCount(schema.compPeers) });
  }

  // ── insider_activity ─────────────────────────────────────────────────
  {
    const rows = allRows("insider_activity");
    if (rows.length) {
      await db
        .insert(schema.insiderActivity)
        .values(
          rows.map((r: any) => ({
            ticker: r.ticker,
            providerStatus: r.provider_status,
            netShares: num(r.net_shares),
            netValueUsd: num(r.net_value_usd),
            buyCount: r.buy_count,
            sellCount: r.sell_count,
            distinctInsiders: r.distinct_insiders,
            validTime: toTimestamp(r.last_transaction_at),
            transactions: parseJson(r.transactions_json),
            detail: r.detail,
            knowledgeTime: toTimestamp(r.fetched_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.insiderActivity.ticker });
    }
    report.push({ table: "insider_activity", sqliteCount: rows.length, postgresCount: await loadCount(schema.insiderActivity) });
  }

  // ── historical_valuation (+ series_json -> historical_valuation_points child) ──
  {
    const rows = allRows("historical_valuation");
    if (rows.length) {
      await db
        .insert(schema.historicalValuation)
        .values(
          rows.map((r: any) => ({
            ticker: r.ticker,
            providerStatus: r.provider_status,
            detail: r.detail,
            validTime: toTimestamp(r.fetched_at),
            knowledgeTime: toTimestamp(r.fetched_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.historicalValuation.ticker });

      const pointRows = rows.flatMap((r: any) => {
        const series = parseJson(r.series_json) as Array<{ period: string; value: number }> | null;
        if (!Array.isArray(series)) return [];
        return series.map((p) => ({
          ticker: r.ticker,
          periodEndDate: p.period,
          peValue: num(p.value)
        }));
      });
      if (pointRows.length) {
        await db
          .insert(schema.historicalValuationPoints)
          .values(pointRows)
          .onConflictDoNothing({
            target: [schema.historicalValuationPoints.ticker, schema.historicalValuationPoints.periodEndDate]
          });
      }
    }
    report.push({ table: "historical_valuation", sqliteCount: rows.length, postgresCount: await loadCount(schema.historicalValuation) });
  }

  // ── hk_buybacks ──────────────────────────────────────────────────────
  {
    const rows = allRows("hk_buybacks");
    if (rows.length) {
      await db
        .insert(schema.hkBuybacks)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            ticker: r.ticker,
            tradeDate: r.trade_date,
            sharesRepurchased: num(r.shares_repurchased),
            priceHigh: num(r.price_high),
            priceLow: num(r.price_low),
            totalConsideration: num(r.total_consideration),
            currency: r.currency,
            sharesIssuedTotal: num(r.shares_issued_total),
            periodEndDate: r.period_end_date,
            sourceTitle: r.source_title,
            sourceUrl: r.source_url,
            publishedAt: toTimestamp(r.published_at),
            knowledgeTime: toTimestamp(r.fetched_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.hkBuybacks.id });
    }
    report.push({ table: "hk_buybacks", sqliteCount: rows.length, postgresCount: await loadCount(schema.hkBuybacks) });
  }

  // ── web_evidence ─────────────────────────────────────────────────────
  {
    const rows = allRows("web_evidence");
    if (rows.length) {
      await db
        .insert(schema.webEvidence)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            ticker: r.ticker,
            intent: r.intent,
            query: r.query,
            title: r.title,
            url: r.url,
            source: r.source,
            sourceType: r.source_type,
            snippet: r.snippet,
            validTime: toTimestamp(r.published_at),
            knowledgeTime: toTimestamp(r.fetched_at) || new Date(),
            relevanceScore: num(r.relevance_score),
            credibilityScore: num(r.credibility_score),
            contentHash: r.content_hash,
            raw: parseJson(r.raw_json),
            createdAt: toTimestamp(r.created_at) || new Date(),
            updatedAt: toTimestamp(r.updated_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.webEvidence.id });
    }
    report.push({ table: "web_evidence", sqliteCount: rows.length, postgresCount: await loadCount(schema.webEvidence) });
  }

  // ── scheduler_state ──────────────────────────────────────────────────
  {
    const rows = allRows("scheduler_state");
    if (rows.length) {
      await db
        .insert(schema.schedulerState)
        .values(
          rows.map((r: any) => ({
            jobId: r.job_id,
            lastRunAt: toTimestamp(r.last_run_at),
            lastStatus: r.last_status,
            lastDetail: r.last_detail
          }))
        )
        .onConflictDoNothing({ target: schema.schedulerState.jobId });
    }
    report.push({ table: "scheduler_state", sqliteCount: rows.length, postgresCount: await loadCount(schema.schedulerState) });
  }

  // ── documents ────────────────────────────────────────────────────────
  {
    const rows = allRows("documents");
    if (rows.length) {
      await db
        .insert(schema.documents)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            userId: r.user_id || "local",
            ticker: r.ticker,
            name: r.name,
            mimeType: r.mime_type,
            size: r.size,
            parser: r.parser,
            text: r.text,
            summary: r.summary,
            sourceType: r.source_type,
            sourceUrl: r.source_url,
            createdAt: toTimestamp(r.created_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.documents.id });
    }
    report.push({ table: "documents", sqliteCount: rows.length, postgresCount: await loadCount(schema.documents) });
  }

  // ── user_preferences ─────────────────────────────────────────────────
  {
    const rows = allRows("user_preferences");
    if (rows.length) {
      await db
        .insert(schema.userPreferences)
        .values(
          rows.map((r: any) => ({
            userId: r.user_id,
            onboardingCompleted: toBool(r.onboarding_completed),
            notifyDigest: toBool(r.notify_digest),
            notifyPositions: toBool(r.notify_positions),
            notifyFalsify: toBool(r.notify_falsify),
            notifyReview: toBool(r.notify_review),
            notifyEarnings: toBool(r.notify_earnings),
            createdAt: toTimestamp(r.created_at) || new Date(),
            updatedAt: toTimestamp(r.updated_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.userPreferences.userId });
    }
    report.push({ table: "user_preferences", sqliteCount: rows.length, postgresCount: await loadCount(schema.userPreferences) });
  }

  // ── feedback ─────────────────────────────────────────────────────────
  {
    const rows = allRows("feedback");
    if (rows.length) {
      await db
        .insert(schema.feedback)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            userId: r.user_id,
            message: r.message,
            context: parseJson(r.context_json),
            status: r.status,
            createdAt: toTimestamp(r.created_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.feedback.id });
    }
    report.push({ table: "feedback", sqliteCount: rows.length, postgresCount: await loadCount(schema.feedback) });
  }

  // ── llm_audit ────────────────────────────────────────────────────────
  {
    const rows = allRows("llm_audit");
    if (rows.length) {
      await db
        .insert(schema.llmAudit)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            userId: r.user_id || "local",
            provider: r.provider,
            model: r.model,
            kind: r.kind,
            status: r.status,
            latencyMs: r.latency_ms,
            errorDetail: r.error_detail,
            inputTokens: r.input_tokens,
            outputTokens: r.output_tokens,
            estimatedCostUsd: num(r.estimated_cost_usd),
            createdAt: toTimestamp(r.created_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.llmAudit.id });
    }
    report.push({ table: "llm_audit", sqliteCount: rows.length, postgresCount: await loadCount(schema.llmAudit) });
  }

  // ── fact_guard_audit ─────────────────────────────────────────────────
  {
    const rows = allRows("fact_guard_audit");
    if (rows.length) {
      await db
        .insert(schema.factGuardAudit)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            ticker: r.ticker,
            mode: r.mode,
            total: r.total,
            passCount: r.pass_count,
            softCount: r.soft_count,
            hardCount: r.hard_count,
            hardDetails: parseJson(r.hard_details),
            createdAt: toTimestamp(r.created_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.factGuardAudit.id });
    }
    report.push({ table: "fact_guard_audit", sqliteCount: rows.length, postgresCount: await loadCount(schema.factGuardAudit) });
  }

  // ── canary_runs ──────────────────────────────────────────────────────
  {
    const rows = allRows("canary_runs");
    if (rows.length) {
      await db
        .insert(schema.canaryRuns)
        .values(
          rows.map((r: any) => ({
            id: r.id,
            batchId: r.batch_id,
            source: r.source,
            ticker: r.ticker,
            status: r.status,
            detail: r.detail,
            latencyMs: r.latency_ms,
            createdAt: toTimestamp(r.created_at) || new Date()
          }))
        )
        .onConflictDoNothing({ target: schema.canaryRuns.id });
    }
    report.push({ table: "canary_runs", sqliteCount: rows.length, postgresCount: await loadCount(schema.canaryRuns) });
  }

  console.table(report);

  const anomalies = report.filter((r) => r.sqliteCount !== r.postgresCount);
  if (anomalies.length) {
    console.warn("\n[ETL] row-count mismatches (expected only if re-run partially or source has FK-orphan rows skipped):");
    console.warn(anomalies);
  } else {
    console.log("\n[ETL] all tables reached row-count parity.");
  }

  await client.end();
  sqliteDb.close();
}

run().catch((err) => {
  console.error("[ETL] failed:", err);
  process.exitCode = 1;
});
