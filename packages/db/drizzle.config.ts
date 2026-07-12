import { defineConfig } from "drizzle-kit";

// R-1 target-schema proof: local Postgres only (no cloud, no Docker).
// DATABASE_URL defaults to the local `echo_dev` database created via
// `createdb echo_dev` against the Homebrew-installed local Postgres 16.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://localhost:5432/echo_dev"
  },
  verbose: true,
  strict: true
});
