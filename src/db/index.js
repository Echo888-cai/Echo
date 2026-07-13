/**
 * Database index — SQLite connection + schema initialization
 *
 * Uses better-sqlite3 for synchronous, fast queries.
 * DB file is stored at project root as echo.db.
 */
import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate.js";

const root = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = join(root, "..", "..", "echo.db");

let db = null;

// Resolved lazily (inside getDb) so tests can point ECHO_DB_PATH at a temp file
// before the first connection — keeps the test suite from polluting the dev DB.
export function dbPath() {
  return process.env.ECHO_DB_PATH || DEFAULT_DB_PATH;
}

export function getDb() {
  if (!db) {
    db = new Database(dbPath());
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  }
  return db;
}
