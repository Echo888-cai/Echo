/**
 * 轻量迁移器（D2）——用 SQLite 自带的 `user_version` PRAGMA 记录已应用到第几个
 * migrations/NNN_*.sql，取代此前散落在 11 个 repository 文件里各自的 ensureTable()/
 * ensureColumns() 自迁移。新 schema 变更以后只新增 `migrations/NNN_*.sql`，不再
 * 回头改已发布的文件。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "migrations");

function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
}

export function runMigrations(db) {
  const applied = db.pragma("user_version", { simple: true });
  const pending = migrationFiles().filter((name) => Number.parseInt(name, 10) > applied);
  for (const name of pending) {
    const version = Number.parseInt(name, 10);
    const sql = readFileSync(join(migrationsDir, name), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}
