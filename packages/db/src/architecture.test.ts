import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rls = readFileSync(join(root, "migrations/0002_tenant_rls.sql"), "utf8");
const privateTables = [
  "auth_sessions", "research_sessions", "company_profiles", "profile_events", "research_snapshots",
  "portfolio_positions", "portfolio_snapshot_totals", "portfolio_snapshots", "watch_rules", "watchlist_prefs",
  "notifications", "documents", "feedback", "llm_audit", "user_preferences"
];

test("every private table has forced RLS and a user_id policy", () => {
  for (const table of privateTables) {
    assert.match(rls, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(rls, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
    assert.match(rls, new RegExp(`CREATE POLICY tenant_isolation ON ${table}`));
  }
  assert.equal((rls.match(/current_setting\('app\.user_id', true\)/g) || []).length, privateTables.length * 2);
});

test("migration runner requires an explicit DATABASE_URL", () => {
  const runner = readFileSync(join(root, "src/migrate.ts"), "utf8");
  assert.match(runner, /DATABASE_URL is required/);
  assert.match(runner, /pg_advisory_lock/);
  assert.match(runner, /applied migration changed/);
});
