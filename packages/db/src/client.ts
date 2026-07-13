import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

export function createDb(connectionString: string) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = postgres(connectionString, { max: 10 });
  return { db: drizzle(client, { schema }), client };
}

/** Same shape as createDb, kept as a distinct function so call sites can express intent
 * (read-only, replication-lag tolerant) even though today it may point at the same
 * PostgreSQL instance — swapping in a real read replica is then just an env var. */
export function createReadDb(connectionString: string) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = postgres(connectionString, { max: 10 });
  return { db: drizzle(client, { schema }), client };
}
