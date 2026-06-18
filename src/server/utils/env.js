/**
 * Tiny .env loader so we don't pull in dotenv. Reads from the given root path
 * and sets process.env entries that have not been set already (env wins).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadEnvFile(root) {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
