import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createDb } from "../client.js";
import * as schema from "../schema/index.js";

export type EchoDb = PostgresJsDatabase<typeof schema>;
export type EchoTx = Parameters<Parameters<EchoDb["transaction"]>[0]>[0];

let connection: ReturnType<typeof createDb> | null = null;

export function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for PostgreSQL repositories");
  connection ||= createDb(process.env.DATABASE_URL);
  return connection.db;
}

export async function closeDatabase() {
  if (!connection) return;
  await connection.client.end();
  connection = null;
}

export async function withTenant<T>(userId: string, operation: (tx: EchoTx) => Promise<T>) {
  return database().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return operation(tx);
  });
}

export function numeric(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  return String(value);
}

export function numberOrNull(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeTicker(input: unknown) {
  const raw = String(input || "").trim().toUpperCase();
  if (!raw) return "";
  if (/^\d{1,5}(?:\.HK)?$/.test(raw)) return `${raw.replace(/\.HK$/, "").padStart(4, "0")}.HK`;
  if (/^\d{6}\.(?:SS|SZ)$/.test(raw)) return raw;
  if (/^\d{6}$/.test(raw)) return `${raw}.${raw.startsWith("6") ? "SS" : "SZ"}`;
  return raw;
}
