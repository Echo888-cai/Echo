import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index.js";

export function createDb(connectionString: string) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = postgres(connectionString, { max: 10 });
  return { db: drizzle(client, { schema }), client };
}
