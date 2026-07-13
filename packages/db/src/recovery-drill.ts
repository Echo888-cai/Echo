import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";

const execFileAsync = promisify(execFile);
const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL is required");
const sourceName = sourceUrl.match(/\/([^/?]+)(?:\?|$)/)?.[1];
if (!sourceName) throw new Error("DATABASE_URL must include a database name");
const drillName = `echo_restore_${process.pid}`;
const adminUrl = sourceUrl.replace(new RegExp(`/${sourceName}(?=\\?|$)`), "/postgres");
const drillUrl = sourceUrl.replace(new RegExp(`/${sourceName}(?=\\?|$)`), `/${drillName}`);
const directory = await mkdtemp(join(tmpdir(), "echo-recovery-"));
const dump = join(directory, "echo.dump");
const source = postgres(sourceUrl, { max: 1 });
const admin = postgres(adminUrl, { max: 1 });

try {
  await admin.unsafe(`drop database if exists ${drillName}`);
  await execFileAsync("pg_dump", ["--format=custom", "--file", dump, sourceUrl], { timeout: 10 * 60_000 });
  await admin.unsafe(`create database ${drillName}`);
  await execFileAsync("pg_restore", ["--no-owner", "--dbname", drillUrl, dump], { timeout: 10 * 60_000 });
  const restored = postgres(drillUrl, { max: 1 });
  try {
    const tables = ["companies", "users", "research_sessions", "company_profiles", "portfolio_positions", "notifications", "hk_financials", "cn_financials"];
    for (const table of tables) {
      const [sourceCount] = await source.unsafe(`select count(*)::int as count from ${table}`);
      const [restoredCount] = await restored.unsafe(`select count(*)::int as count from ${table}`);
      assert.equal(Number(restoredCount.count), Number(sourceCount.count), `${table} row count differs after restore`);
    }
    const [rls] = await restored`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'research_sessions'`;
    assert.equal(rls.relrowsecurity, true);
    assert.equal(rls.relforcerowsecurity, true);
    console.log(`[recovery] restored ${tables.length} critical tables and retained forced RLS`);
  } finally {
    await restored.end();
  }
} finally {
  await source.end();
  await admin.unsafe(`drop database if exists ${drillName}`);
  await admin.end();
  await rm(directory, { recursive: true, force: true });
}
