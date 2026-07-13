/**
 * Test harness for the NEW NestJS app — mirrors
 * packages/contracts/src/contract-tests/helpers.ts exactly (same isolated-SQLite-file
 * trick, same env vars), just spawning `tsx apps/api/src/main.ts` instead of
 * `node server.js`, and polling `API_PORT` instead of `PORT`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");
const apiRoot = join(repoRoot, "apps", "api");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const mainTs = join(apiRoot, "src", "main.ts");

export interface TestServer {
  baseUrl: string;
  proc: ChildProcess;
  dbPath: string;
  stop: () => Promise<void>;
}

function pickPort(): number {
  // Different fixed-ish range than the server.js contract tests (helpers.ts uses
  // 41730+pid%1000) so the two suites can run concurrently without port clashes.
  return 43730 + (process.pid % 1000);
}

export async function startTestServer(): Promise<TestServer> {
  const tmpDir = mkdtempSync(join(tmpdir(), "echo-nest-contract-"));
  const dbPath = join(tmpDir, "test.db");
  const port = pickPort();

  const proc = spawn(tsxBin, [mainTs], {
    cwd: apiRoot,
    env: {
      ...process.env,
      API_PORT: String(port),
      ECHO_DB_PATH: dbPath,
      ECHO_AUTH_DISABLED: "1",
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
    dbPath,
    stop: async () => {
      proc.kill();
      await new Promise((resolve) => proc.once("exit", resolve));
      rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}

async function waitForServer(baseUrl: string, proc: ChildProcess, getStderr: () => string, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`NestJS app exited early (code ${proc.exitCode}):\n${getStderr()}`);
    }
    try {
      const res = await fetch(`${baseUrl}/api/status`, { headers: { "X-Echo-Auth": "1" } });
      if (res.status) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`NestJS app did not become ready within ${timeoutMs}ms:\n${getStderr()}`);
}

/** All non-GET requests need this header (CSRF middleware mirrors server.js). */
export function jsonHeaders(extra: Record<string, string> = {}) {
  return { "Content-Type": "application/json", "X-Echo-Auth": "1", ...extra };
}
