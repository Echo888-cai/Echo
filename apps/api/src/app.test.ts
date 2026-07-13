import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusResponseSchema, companySearchResponseSchema } from "@echo/contracts";

const tempDir = mkdtempSync(join(tmpdir(), "echo-hono-"));
process.env.ECHO_DB_PATH = join(tempDir, "api.db");
process.env.ECHO_AUTH_DISABLED = "1";
process.env.ECHO_DISABLE_SCHEDULER = "1";

let app: Awaited<typeof import("./app.js")>["app"];

before(async () => {
  ({ app } = await import("./app.js"));
});

after(() => rmSync(tempDir, { recursive: true, force: true }));

test("Hono REST status matches the existing contract", async () => {
  const response = await app.request("/api/status");
  assert.equal(response.status, 200);
  statusResponseSchema.parse(await response.json());
});

test("Hono REST company search preserves the envelope contract", async () => {
  const response = await app.request("/api/companies/search?q=AAPL");
  assert.equal(response.status, 200);
  companySearchResponseSchema.parse(await response.json());
});

test("tRPC status uses the same status builder", async () => {
  const response = await app.request("/trpc/status");
  assert.equal(response.status, 200);
  const payload = await response.json() as { result: { data: unknown } };
  statusResponseSchema.parse(payload.result.data);
});

test("new API rejects unauthenticated requests when auth is enabled", async () => {
  process.env.ECHO_AUTH_DISABLED = "0";
  const { getDb } = await import("../../../src/db/index.js");
  getDb().prepare("INSERT OR IGNORE INTO users (id, username, pass_hash, role) VALUES ('local', 'owner', 'x', 'owner')").run();
  const response = await app.request("/api/status");
  assert.equal(response.status, 401);
  process.env.ECHO_AUTH_DISABLED = "1";
});
