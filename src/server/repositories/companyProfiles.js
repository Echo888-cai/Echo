/**
 * company_profiles repository — 长期公司画像（对标 HoneClaw 的 Company Portrait）。
 *
 * 设计原则（来自 HoneClaw profile-framework）：
 * - 画像是"当前仍然成立的最佳观点"，不是历史流水账。判断变了就改正文。
 * - 单独保留一条 events 日志，只在投资主线/状态/置信度发生变化时追加。
 *
 * 我们是"结构化面板优先"的产品，所以画像同时存结构化字段（自动注入研究上下文）
 * 和一份生成的 Markdown 视图（前端展示 + 导出）。
 */

import { getDb } from "../../db/index.js";
import { normalizeTicker } from "../../data.js";
import { detectMarket } from "../../market.js";

let ensured = false;
function ensureTable() {
  if (ensured) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_profiles (
      ticker          TEXT PRIMARY KEY,
      company_name    TEXT,
      thesis          TEXT,
      research_status TEXT,
      confidence      TEXT,
      bull_json       TEXT,
      bear_json       TEXT,
      monitors_json   TEXT,
      falsifiers_json TEXT,
      valuation_json  TEXT,
      events_json     TEXT,
      profile_md      TEXT,
      turn_count      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensured = true;
}

function ensureCompanyRow(db, ticker, name) {
  if (!ticker) return;
  try {
    const us = detectMarket(ticker) === "US";
    db.prepare(
      `INSERT OR IGNORE INTO companies (ticker, name_zh, name_en, exchange, currency, listing_status)
       VALUES (?, ?, ?, ?, ?, 'active')`
    ).run(ticker, name || ticker, us ? name || ticker : null, us ? "US" : "HKEX", us ? "USD" : "HKD");
  } catch {
    // best effort
  }
}

function safeParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function hydrate(row) {
  if (!row) return null;
  return {
    ticker: row.ticker,
    companyName: row.company_name || row.ticker,
    thesis: row.thesis || "",
    researchStatus: row.research_status || "",
    confidence: row.confidence || "",
    bull: safeParse(row.bull_json, []),
    bear: safeParse(row.bear_json, []),
    monitors: safeParse(row.monitors_json, []),
    falsifiers: safeParse(row.falsifiers_json, []),
    valuation: safeParse(row.valuation_json, null),
    events: safeParse(row.events_json, []),
    profileMd: row.profile_md || "",
    turnCount: row.turn_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function getCompanyProfile(ticker) {
  ensureTable();
  const db = getDb();
  const row = db.prepare("SELECT * FROM company_profiles WHERE ticker = ?").get(normalizeTicker(ticker));
  return hydrate(row);
}

export function listCompanyProfiles(limit = 50) {
  ensureTable();
  const db = getDb();
  const rows = db.prepare(`
    SELECT ticker, company_name, thesis, research_status, confidence, turn_count, updated_at
    FROM company_profiles
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
  return rows.map((r) => ({
    ticker: r.ticker,
    companyName: r.company_name || r.ticker,
    thesis: r.thesis || "",
    researchStatus: r.research_status || "",
    confidence: r.confidence || "",
    turnCount: r.turn_count || 0,
    updatedAt: r.updated_at
  }));
}

/**
 * Upsert a profile. `patch` carries the new current-view fields plus an optional
 * `event` to append. Current-view fields are overwritten (not accumulated);
 * events are append-only and capped.
 */
export function upsertCompanyProfile(ticker, patch = {}) {
  ensureTable();
  const db = getDb();
  const normalized = normalizeTicker(ticker);
  ensureCompanyRow(db, normalized, patch.companyName);
  const existing = getCompanyProfile(normalized);

  const events = Array.isArray(existing?.events) ? [...existing.events] : [];
  if (patch.event) events.push(patch.event);
  const cappedEvents = events.slice(-40);

  const merged = {
    companyName: patch.companyName || existing?.companyName || normalized,
    thesis: patch.thesis ?? existing?.thesis ?? "",
    researchStatus: patch.researchStatus ?? existing?.researchStatus ?? "",
    confidence: patch.confidence ?? existing?.confidence ?? "",
    bull: patch.bull ?? existing?.bull ?? [],
    bear: patch.bear ?? existing?.bear ?? [],
    monitors: patch.monitors ?? existing?.monitors ?? [],
    falsifiers: patch.falsifiers ?? existing?.falsifiers ?? [],
    valuation: patch.valuation ?? existing?.valuation ?? null,
    turnCount: (existing?.turnCount || 0) + (patch.bumpTurn ? 1 : 0)
  };
  const profileMd = patch.profileMd || renderProfileMarkdown(normalized, merged, cappedEvents);

  db.prepare(`
    INSERT INTO company_profiles
      (ticker, company_name, thesis, research_status, confidence, bull_json, bear_json,
       monitors_json, falsifiers_json, valuation_json, events_json, profile_md, turn_count, updated_at)
    VALUES
      (@ticker, @companyName, @thesis, @researchStatus, @confidence, @bull, @bear,
       @monitors, @falsifiers, @valuation, @events, @profileMd, @turnCount, datetime('now'))
    ON CONFLICT(ticker) DO UPDATE SET
      company_name = excluded.company_name,
      thesis = excluded.thesis,
      research_status = excluded.research_status,
      confidence = excluded.confidence,
      bull_json = excluded.bull_json,
      bear_json = excluded.bear_json,
      monitors_json = excluded.monitors_json,
      falsifiers_json = excluded.falsifiers_json,
      valuation_json = excluded.valuation_json,
      events_json = excluded.events_json,
      profile_md = excluded.profile_md,
      turn_count = excluded.turn_count,
      updated_at = datetime('now')
  `).run({
    ticker: normalized,
    companyName: merged.companyName,
    thesis: merged.thesis,
    researchStatus: merged.researchStatus,
    confidence: merged.confidence,
    bull: JSON.stringify(merged.bull),
    bear: JSON.stringify(merged.bear),
    monitors: JSON.stringify(merged.monitors),
    falsifiers: JSON.stringify(merged.falsifiers),
    valuation: merged.valuation ? JSON.stringify(merged.valuation) : null,
    events: JSON.stringify(cappedEvents),
    profileMd,
    turnCount: merged.turnCount
  });
  return getCompanyProfile(normalized);
}

export function deleteCompanyProfile(ticker) {
  ensureTable();
  const db = getDb();
  return db.prepare("DELETE FROM company_profiles WHERE ticker = ?").run(normalizeTicker(ticker)).changes > 0;
}

/** Render the current-view fields + events into a Markdown portrait (frontend + export). */
export function renderProfileMarkdown(ticker, view = {}, events = []) {
  const lines = [
    `---`,
    `ticker: ${ticker}`,
    `---`,
    ``,
    `# ${view.companyName || ticker}（${ticker}）`,
    ``,
    `## 投资主线`,
    view.thesis ? view.thesis : "（待沉淀）",
    ``
  ];
  if (view.researchStatus || view.confidence) {
    lines.push(`研究状态：${view.researchStatus || "—"} · 置信度：${view.confidence || "—"}`, "");
  }
  if (Array.isArray(view.bull) && view.bull.length) {
    lines.push("## Bull case", ...view.bull.map((x) => `- ${x}`), "");
  }
  if (Array.isArray(view.bear) && view.bear.length) {
    lines.push("## Bear case", ...view.bear.map((x) => `- ${x}`), "");
  }
  if (Array.isArray(view.monitors) && view.monitors.length) {
    lines.push("## 关键观察变量", ...view.monitors.map((x) => `- ${x}`), "");
  }
  if (Array.isArray(view.falsifiers) && view.falsifiers.length) {
    lines.push("## 证伪条件", ...view.falsifiers.map((x) => `- ${x}`), "");
  }
  if (events.length) {
    lines.push("## 投资主线变更日志", ...events.slice(-12).reverse().map((e) => `- ${e.date || ""}：${e.summary || ""}`), "");
  }
  return lines.join("\n");
}
