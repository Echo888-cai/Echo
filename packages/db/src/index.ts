/**
 * @echo/db — Postgres + Drizzle target schema (R-1 data foundation proof).
 *
 * `createDb(connectionString)` returns a drizzle client bound to the local `echo_dev`
 * Postgres instance (or whatever DATABASE_URL points at). This package is additive:
 * it does not read or write echo.db except via the one-off ETL script under
 * src/etl/, and nothing in the running app (server.js, src/db/**) imports it yet.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

export * as schema from "./schema/index.js";

export function createDb(connectionString = process.env.DATABASE_URL || "postgres://localhost:5432/echo_dev") {
  const client = postgres(connectionString, { max: 10 });
  return { db: drizzle(client, { schema }), client };
}
