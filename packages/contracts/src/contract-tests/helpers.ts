/**
 * Test harness: spawns the real server.js as a child process against an isolated,
 * throwaway SQLite file (same LUVIO_DB_PATH isolation trick as tests/setupTestDb.mjs
 * uses for the existing in-process test suite — reused here rather than invented,
 * just applied to a child process instead of an import). Auth is disabled via
 * LUVIO_AUTH_DISABLED=1 so requests run as the legacy single-user "owner" without
 * needing to drive cookie-based login — the contract suite focuses on DB-backed
 * endpoints, not the auth state machine (that's covered by tests/phase-u1.mjs).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..", "..");

export interface TestServer {
  baseUrl: string;
  proc: ChildProcess;
  dbPath: string;
  stop: () => Promise<void>;
}

function pickPort(): number {
  // Fixed-ish range, offset by pid to reduce collision odds across parallel runs.
  return 41730 + (process.pid % 1000);
}

export async function startTestServer(): Promise<TestServer> {
  const tmpDir = mkdtempSync(join(tmpdir(), "echo-contract-"));
  const dbPath = join(tmpDir, "test.db");
  const port = pickPort();

  const proc = spawn(process.execPath, [join(repoRoot, "server.js")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      LUVIO_DB_PATH: dbPath,
      LUVIO_AUTH_DISABLED: "1",
      LUVIO_DISABLE_SCHEDULER: "1",
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
    dbPath,
    stop: async () => {
      proc.kill();
      await new Promise((resolve) => proc.once("exit", resolve));
      rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}

async function waitForServer(baseUrl: string, proc: ChildProcess, getStderr: () => string, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`server.js exited early (code ${proc.exitCode}):\n${getStderr()}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/status`, { headers: { "X-Echo-Auth": "1" } });
      if (res.status) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server.js did not become ready within ${timeoutMs}ms:\n${getStderr()}`);
}

/** All non-GET requests need this header (CSRF gate in server.js). */
export function jsonHeaders(extra: Record<string, string> = {}) {
  return { "Content-Type": "application/json", "X-Echo-Auth": "1", ...extra };
}
