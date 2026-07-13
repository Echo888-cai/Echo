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

function hydrate(row, userId = "local") {
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
    events: listProfileEvents(row.ticker, 200, userId),
    profileMd: row.profile_md || "",
    turnCount: row.turn_count || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** 追加一条判断变化事件（画像时间线）。只有判断变化才该调它——不是交易日志。 */
export function appendProfileEvent(ticker, event = {}, userId = "local") {
  if (!event.summary) return;
  const db = getDb();
  db.prepare(`
    INSERT INTO profile_events (user_id, ticker, date, kind, summary, rationale, evidence_json, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    normalizeTicker(ticker),
    event.date || "",
    event.kind || "note",
    String(event.summary).slice(0, 300),
    event.rationale ? String(event.rationale).slice(0, 600) : null,
    Array.isArray(event.evidence) && event.evidence.length ? JSON.stringify(event.evidence.slice(0, 4)) : null,
    event.sessionId || null
  );
}

/** 按时间正序返回时间线（date/kind/summary/rationale/evidence/sessionId）。 */
export function listProfileEvents(ticker, limit = 200, userId = "local") {
  const db = getDb();
  const rows = db.prepare(`
    SELECT date, kind, summary, rationale, evidence_json, session_id
    FROM profile_events WHERE user_id = ? AND ticker = ? ORDER BY id DESC LIMIT ?
  `).all(userId, normalizeTicker(ticker), limit);
  return rows.reverse().map((r) => ({
    date: r.date,
    kind: r.kind,
    summary: r.summary,
    rationale: r.rationale || "",
    evidence: safeParse(r.evidence_json, []),
    sessionId: r.session_id || null
  }));
}

export function getCompanyProfile(ticker, userId = "local") {
  const db = getDb();
  const row = db.prepare("SELECT * FROM company_profiles WHERE user_id = ? AND ticker = ?").get(userId, normalizeTicker(ticker));
  return hydrate(row, userId);
}

export function listCompanyProfiles(limit = 50, userId = "local") {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ticker, company_name, thesis, research_status, confidence, turn_count, updated_at
    FROM company_profiles
    WHERE user_id = ?
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(userId, limit);
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
 * Upsert a profile. `patch` carries the new current-view fields plus optional
 * `event`（单条）/`events`（多条）to append to the timeline (profile_events 表)。
 * Current-view fields are overwritten (not accumulated); events are append-only.
 */
export function upsertCompanyProfile(ticker, patch = {}, userId = "local") {
  const db = getDb();
  const normalized = normalizeTicker(ticker);
  ensureCompanyRow(db, normalized, patch.companyName);
  const existing = getCompanyProfile(normalized, userId);

  const newEvents = [...(Array.isArray(patch.events) ? patch.events : []), ...(patch.event ? [patch.event] : [])];
  for (const e of newEvents) appendProfileEvent(normalized, e, userId);
  const allEvents = listProfileEvents(normalized, 200, userId);

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
  const profileMd = patch.profileMd || renderProfileMarkdown(normalized, merged, allEvents);

  db.prepare(`
    INSERT INTO company_profiles
      (user_id, ticker, company_name, thesis, research_status, confidence, bull_json, bear_json,
       monitors_json, falsifiers_json, valuation_json, profile_md, turn_count, updated_at)
    VALUES
      (@userId, @ticker, @companyName, @thesis, @researchStatus, @confidence, @bull, @bear,
       @monitors, @falsifiers, @valuation, @profileMd, @turnCount, datetime('now'))
    ON CONFLICT(user_id, ticker) DO UPDATE SET
      company_name = excluded.company_name,
      thesis = excluded.thesis,
      research_status = excluded.research_status,
      confidence = excluded.confidence,
      bull_json = excluded.bull_json,
      bear_json = excluded.bear_json,
      monitors_json = excluded.monitors_json,
      falsifiers_json = excluded.falsifiers_json,
      valuation_json = excluded.valuation_json,
      profile_md = excluded.profile_md,
      turn_count = excluded.turn_count,
      updated_at = datetime('now')
  `).run({
    userId,
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
    profileMd,
    turnCount: merged.turnCount
  });
  return getCompanyProfile(normalized, userId);
}

export function deleteCompanyProfile(ticker, userId = "local") {
  const db = getDb();
  const normalized = normalizeTicker(ticker);
  db.prepare("DELETE FROM profile_events WHERE user_id = ? AND ticker = ?").run(userId, normalized);
  return db.prepare("DELETE FROM company_profiles WHERE user_id = ? AND ticker = ?").run(userId, normalized).changes > 0;
}

export const PROFILE_EVENT_KIND_LABEL = {
  created: "建档",
  thesis_change: "判断变化",
  falsifier_change: "证伪线更新",
  earnings_report: "财报公布", // F-2：业绩后自动核对（实际值 vs 预期），非模型推断
  note: "记录"
};

/**
 * Render the current-view fields + timeline into a Markdown 主档案 (frontend + export)。
 * 结构：投资主线 / 关键指标 / Bull / 风险台账 / 证伪条件 / 判断变化时间线（带理由与证据）。
 * 画像是长期研究资产，不是交易日志——正文永远是"当前仍成立的最佳观点"，历史进时间线。
 */
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
  const v = view.valuation;
  const metrics = [];
  if (v && (v.base != null || v.bear != null || v.bull != null)) {
    const band = ["悲观 " + (v.bear ?? "—"), "中性 " + (v.base ?? "—"), "乐观 " + (v.bull ?? "—")].join(" / ");
    metrics.push(`- 估值带（${v.method || "—"}）：${band}${v.currentPrice != null ? `（现价 ${v.currentPrice}）` : ""}`);
  }
  if (Array.isArray(view.monitors) && view.monitors.length) {
    metrics.push(`- 关键观察变量：${view.monitors.join("、")}`);
  }
  if (metrics.length) lines.push("## 关键指标", ...metrics, "");
  if (Array.isArray(view.bull) && view.bull.length) {
    lines.push("## Bull case", ...view.bull.map((x) => `- ${x}`), "");
  }
  if (Array.isArray(view.bear) && view.bear.length) {
    lines.push("## 风险台账（Bear case）", ...view.bear.map((x) => `- ${x}`), "");
  }
  if (Array.isArray(view.falsifiers) && view.falsifiers.length) {
    lines.push("## 证伪条件（当前生效）", ...view.falsifiers.map((x) => `- ${x}`), "");
  }
  if (events.length) {
    lines.push("## 判断变化时间线");
    for (const e of events.slice(-20).reverse()) {
      lines.push("", `### ${e.date || "—"} · ${PROFILE_EVENT_KIND_LABEL[e.kind] || e.kind || "记录"}`, e.summary || "");
      if (e.rationale) lines.push(`- 理由：${e.rationale}`);
      for (const ev of Array.isArray(e.evidence) ? e.evidence : []) {
        if (ev?.url) lines.push(`- 证据：[${ev.title || ev.url}](${ev.url})`);
      }
    }
    lines.push("");
  }
  lines.push("---", "> 由 Echo Research 生成的长期研究画像，仅供研究学习，不构成投资建议。");
  return lines.join("\n");
}
