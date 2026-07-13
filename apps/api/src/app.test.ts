import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { statusResponseSchema, companySearchResponseSchema } from "@echo/contracts";
import { ensureLocalUser } from "@echo/db/repositories/authRepository.js";
import { closeDatabase } from "@echo/db/repositories/context.js";

process.env.ECHO_AUTH_DISABLED = "1";
process.env.ECHO_DISABLE_SCHEDULER = "1";

let app: Awaited<typeof import("./app.js")>["app"];
let appRouter: Awaited<typeof import("./app.js")>["appRouter"];

before(async () => {
  ({ app, appRouter } = await import("./app.js"));
  await ensureLocalUser("local");
});

after(async () => {
  await closeDatabase();
});

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

test("tRPC procedures preserve typed portfolio round-trip semantics", async () => {
  const caller = appRouter.createCaller({
    user: { id: "local", username: "local", displayName: "本机用户", role: "owner" },
    request: new Request("http://local/trpc", { headers: { "X-Echo-Auth": "1" } }),
    responseHeaders: new Headers()
  });
  const saved = await caller.portfolio.upsert({ ticker: "TRPCTEST", companyName: "tRPC Test", shares: 2, avgCost: 3 });
  assert.equal(saved.position.ticker, "TRPCTEST");
  const listed = await caller.portfolio.list();
  assert.ok(listed.positions.some((position) => position.ticker === "TRPCTEST"));
  const removed = await caller.portfolio.remove({ ticker: "TRPCTEST" });
  assert.equal(removed.deleted, true);
});

test("new API rejects unauthenticated requests when auth is enabled", async () => {
  process.env.ECHO_AUTH_DISABLED = "0";
  const response = await app.request("/api/status");
  assert.equal(response.status, 401);
  process.env.ECHO_AUTH_DISABLED = "1";
});
