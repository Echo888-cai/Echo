import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sqlitePath = process.env.ECHO_DB_PATH || fileURLToPath(new URL("../../../../echo.db", import.meta.url));
const sqlite = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const pg = postgres(databaseUrl, { max: 1 });
const safe = (name: string) => {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return `"${name}"`;
};
const digest = (rows: unknown[][]) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const canonicalKey = (value: unknown) => value == null
  ? null
  : value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value);
const PRIMARY_KEY_RENAMES: Record<string, Record<string, string>> = {
  portfolio_snapshots: { snapshot_date: "valid_time" }
};

async function verify() {
  const sqliteTables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((row) => row.name)
    .filter((name) => /^[a-z][a-z0-9_]*$/.test(name));
  const pgTables = await pg<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  const common = sqliteTables.filter((name) => pgTables.some((row) => row.table_name === name)).sort();
  const failures: string[] = [];

  for (const table of common) {
    const sqliteCount = Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${safe(table)}`).get() as { n: number }).n);
    // ETL may add disabled identities for legacy rows whose user was deleted. They are
    // referential-integrity sentinels, not migrated source rows, and are checked separately.
    const pgFilter = table === "users"
      ? " WHERE username NOT LIKE '__archived__%'"
      : table === "companies"
        ? " WHERE market_cap_category IS DISTINCT FROM '__migration_placeholder__'"
        : "";
    const [{ n: pgCountText }] = await pg.unsafe<{ n: string }[]>(`SELECT COUNT(*)::text AS n FROM ${safe(table)}${pgFilter}`);
    const pgCount = Number(pgCountText);
    if (sqliteCount !== pgCount) {
      failures.push(`${table}: count ${sqliteCount} != ${pgCount}`);
      continue;
    }

    const sqlitePk = (sqlite.prepare(`PRAGMA table_info(${safe(table)})`).all() as { name: string; pk: number }[])
      .filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    if (!sqlitePk.length) continue;
    const pgPk = await pg<{ column_name: string }[]>`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public' AND tc.table_name = ${table} AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `;
    const expectedPgPk = sqlitePk.map((column) => PRIMARY_KEY_RENAMES[table]?.[column] || column);
    if (pgPk.map((column) => column.column_name).join(",") !== expectedPgPk.join(",")) {
      failures.push(`${table}: primary key differs`);
      continue;
    }
    const sqliteColumns = sqlitePk.map(safe).join(", ");
    const sqliteOrder = sqlitePk.map(safe).join(", ");
    const pgColumns = expectedPgPk.map(safe).join(", ");
    const pgOrder = expectedPgPk.map(safe).join(", ");
    const sqliteKeys = sqlite.prepare(`SELECT ${sqliteColumns} FROM ${safe(table)} ORDER BY ${sqliteOrder}`).all()
      .map((row: any) => sqlitePk.map((column) => canonicalKey(row[column])));
    const pgRows = await pg.unsafe<Record<string, unknown>[]>(`SELECT ${pgColumns} FROM ${safe(table)}${pgFilter} ORDER BY ${pgOrder}`);
    const pgKeys = pgRows.map((row) => expectedPgPk.map((column) => canonicalKey(row[column])));
    if (digest(sqliteKeys) !== digest(pgKeys)) failures.push(`${table}: primary-key fingerprint differs`);
  }

  if (common.includes("users")) {
    const archived = await pg<{ id: string }[]>`
      SELECT id FROM users WHERE username LIKE '__archived__%' ORDER BY id
    `;
    for (const { id } of archived) {
      const references = await pg<{ found: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM auth_sessions WHERE user_id = ${id}
          UNION ALL SELECT 1 FROM research_sessions WHERE user_id = ${id}
          UNION ALL SELECT 1 FROM company_profiles WHERE user_id = ${id}
          UNION ALL SELECT 1 FROM research_snapshots WHERE user_id = ${id}
          UNION ALL SELECT 1 FROM portfolio_positions WHERE user_id = ${id}
          UNION ALL SELECT 1 FROM documents WHERE user_id = ${id}
        ) AS found
      `;
      if (!references[0]?.found) failures.push(`users: archived identity ${id} has no retained data`);
    }
  }

  console.log(`[db:verify] checked ${common.length} shared tables`);
  if (failures.length) throw new Error(`SQLite/PostgreSQL parity failed:\n${failures.join("\n")}`);
  console.log("[db:verify] row counts and primary-key fingerprints match");
}

try {
  await verify();
} finally {
  sqlite.close();
  await pg.end();
}
