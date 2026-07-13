import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDir = join(here, "..", "migrations");
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL is required; migrations never guess a production database");

const client = postgres(connectionString, { max: 1, onnotice: () => undefined });
const checksum = (text: string) => createHash("sha256").update(text).digest("hex");

async function migrate() {
  await client`SELECT pg_advisory_lock(hashtext('echo_schema_migrations'))`;
  try {
    await client.unsafe(`
      CREATE TABLE IF NOT EXISTS echo_schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationDir)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
    for (const name of files) {
      const sqlText = await readFile(join(migrationDir, name), "utf8");
      const digest = checksum(sqlText);
      const [existing] = await client<{ checksum: string }[]>`
        SELECT checksum FROM echo_schema_migrations WHERE name = ${name}
      `;
      if (existing) {
        if (existing.checksum !== digest) throw new Error(`applied migration changed: ${name}`);
        continue;
      }
      await client.begin(async (tx) => {
        await tx.unsafe(sqlText);
        await tx`INSERT INTO echo_schema_migrations (name, checksum) VALUES (${name}, ${digest})`;
      });
      console.log(`[db:migrate] applied ${name}`);
    }
  } finally {
    await client`SELECT pg_advisory_unlock(hashtext('echo_schema_migrations'))`;
    await client.end();
  }
}

await migrate();
