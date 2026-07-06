// D2 测试：轻量 DB 迁移器（`user_version` + `migrations/NNN_*.sql`）。
// 验证迁移器本身的契约：全新库能跑到最新版本、建出全部表；重复调用幂等；
// 之前散落在各 repository 里靠运行时 ALTER TABLE 补的列（如 research_sessions
// 的 conversation_id/decision_panel 等）已经在 001_init.sql 里就是最终形态。
import "./setupTestDb.mjs";
import { getDb } from "../src/db/index.js";
import { runMigrations } from "../src/db/migrate.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const EXPECTED_TABLES = [
  "companies", "company_details", "market_snapshots", "research_sessions",
  "company_profiles", "profile_events", "portfolio_positions", "notifications",
  "hk_financials", "scheduler_state", "web_evidence", "watchlist_prefs",
  "watch_rules", "documents", "canary_runs", "hk_filing_ingest_log", "earnings_calendar", "comp_peers", "llm_audit",
  "research_snapshots", "fact_guard_audit", "insider_activity"
];

console.log("[1] 全新库：迁移到最新版本，全部表就位");
{
  const db = getDb();
  const version = db.pragma("user_version", { simple: true });
  check("user_version 推进到 10（001_init + 002_g1_health + 003_earnings_calendar + 004_comp_peers + 005_llm_audit + 006_research_snapshots + 007_fact_guard_audit + 008_earnings_actuals + 009_watch_rules_metric + 010_insider_activity）", version === 10, `实际 ${version}`);

  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  );
  for (const name of EXPECTED_TABLES) {
    check(`表存在：${name}`, tables.has(name));
  }
}

console.log("[2] 重复调用 runMigrations：幂等，不报错");
{
  const db = getDb();
  const before = db.pragma("user_version", { simple: true });
  let threw = false;
  try { runMigrations(db); } catch { threw = true; }
  const after = db.pragma("user_version", { simple: true });
  check("不抛出", !threw);
  check("版本不变", before === after, `${before} -> ${after}`);
}

console.log("[3] research_sessions：此前靠运行时 ALTER TABLE 补的列已在 001_init.sql 里就位");
{
  const db = getDb();
  const cols = new Set(db.prepare("PRAGMA table_info(research_sessions)").all().map((c) => c.name));
  for (const name of ["conversation_id", "title", "decision_panel", "full_research", "data_sources", "thread_json", "turn_count"]) {
    check(`列存在：${name}`, cols.has(name));
  }
}

console.log("[4] earnings_calendar：008_earnings_actuals 的 last_* 列（F-2 业绩闭环）已就位");
{
  const db = getDb();
  const cols = new Set(db.prepare("PRAGMA table_info(earnings_calendar)").all().map((c) => c.name));
  for (const name of ["last_date", "last_quarter", "last_year", "last_eps_estimate", "last_eps_actual", "last_revenue_estimate", "last_revenue_actual", "last_eps_surprise_pct", "last_revenue_surprise_pct"]) {
    check(`列存在：${name}`, cols.has(name));
  }
}

console.log("[5] watch_rules：009_watch_rules_metric 的 metric 列（F-3 基本面证伪条件）已就位");
{
  const db = getDb();
  const cols = new Set(db.prepare("PRAGMA table_info(watch_rules)").all().map((c) => c.name));
  check("列存在：metric", cols.has("metric"));
}

console.log(`\nD2: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
