/**
 * Test harness: spawns the Hono API against an isolated PostgreSQL tenant.
 * Auth is bypassed only for that tenant; RLS and repository user filters remain active.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");

export interface TestServer {
  baseUrl: string;
  proc: ChildProcess;
  stop: () => Promise<void>;
}

function pickPort(): number {
  // Fixed-ish range, offset by pid to reduce collision odds across parallel runs.
  return 41730 + (process.pid % 1000);
}

export async function startTestServer(): Promise<TestServer> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for contract tests");
  const tenant = `__contract_${process.pid}__`;
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  await sql`insert into users (id, username, pass_hash) values (${tenant}, ${tenant}, '!test') on conflict (id) do nothing`;
  const port = pickPort();

  const proc = spawn(process.execPath, [join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), join(repoRoot, "apps", "api", "src", "server.ts")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      API_PORT: String(port),
      ECHO_AUTH_DISABLED: "1",
      ECHO_AUTH_DISABLED_USER_ID: tenant,
      ECHO_DISABLE_SCHEDULER: "1",
      NODE_ENV: "test"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderrBuf = "";
  proc.stderr?.on("data", (chunk) => { stderrBuf += chunk.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, proc, () => stderrBuf);

  return {
    baseUrl,
    proc,
    stop: async () => {
      proc.kill();
      await new Promise((resolve) => proc.once("exit", resolve));
      for (const table of ["portfolio_snapshot_totals", "notifications", "feedback", "portfolio_positions", "portfolio_snapshots", "watchlist_prefs", "watch_rules", "company_profiles", "profile_events", "research_sessions", "research_snapshots", "documents", "llm_audit", "user_preferences"]) {
        await sql.unsafe(`delete from ${table} where user_id = $1`, [tenant]);
      }
      await sql`delete from users where id = ${tenant}`;
      await sql.end();
    }
  };
}

async function waitForServer(baseUrl: string, proc: ChildProcess, getStderr: () => string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`Hono API exited early (code ${proc.exitCode}):\n${getStderr()}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/status`, { headers: { "X-Echo-Auth": "1" } });
      if (res.status) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Hono API did not become ready within ${timeoutMs}ms:\n${getStderr()}`);
}

/** All non-GET requests need the Hono CSRF header. */
export function jsonHeaders(extra: Record<string, string> = {}) {
  return { "Content-Type": "application/json", "X-Echo-Auth": "1", ...extra };
}
