/**
 * Contract tests: spins up the Hono API against an isolated PostgreSQL tenant, auth
 * disabled) and validates live HTTP responses against the zod schemas in
 * packages/contracts/src. Scope: endpoints backed by local DB / pure logic only —
 * no live market data, web search, or LLM calls (those degrade gracefully but
 * would make this suite flaky/slow/network-dependent, per the R-0 brief).
 *
 * Skipped on purpose (documented, not silently dropped):
 *   - /api/ask, /api/chat, /api/report/generate, /api/discover  → require a
 *     configured LLM provider and often stream SSE; contracted in chat.ts/ask.ts/
 *     discover.ts/reports.ts but not exercised here.
 *   - /api/companies/verify, /api/companies/resolve             → call out to
 *     FMP/Finnhub/LLM for ticker verification.
 *   - /api/watch/desk, /api/watch/stock, /api/events/digest     → pull live market
 *     snapshots + news for each tracked ticker (slow, network-dependent).
 *   - /api/hk-financials/ingest                                 → scrapes HKEX PDFs.
 * Authentication mutation behavior is covered by the API boundary suite.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, jsonHeaders, type TestServer } from "./helpers.js";
import {
  statusResponseSchema,
  preferencesGetResponseSchema, preferencesUpdateResponseSchema, feedbackCreateResponseSchema,
  authMeResponseSchema,
  companySearchResponseSchema,
  portfolioUpsertResponseSchema, portfolioListResponseSchema, portfolioReviewResponseSchema,
  portfolioSnapshotsResponseSchema, portfolioDeleteResponseSchema,
  notificationsListResponseSchema, notificationsUnreadResponseSchema, notificationsReadResponseSchema,
  schedulerStatusResponseSchema,
  watchTrackResponseSchema, watchUntrackResponseSchema,
  profileListResponseSchema, researchScorecardResponseSchema,
  sessionListResponseSchema, conversationListResponseSchema, sessionClearResponseSchema,
  hkFinancialsListResponseSchema
} from "../index.js";

let server: TestServer;

before(async () => {
  server = await startTestServer();
});

after(async () => {
  await server.stop();
});

async function getJson(path: string) {
  const res = await fetch(`${server.baseUrl}${path}`, { headers: jsonHeaders() });
  const body = await res.json();
  return { status: res.status, body };
}

async function postJson(path: string, payload: unknown, method: "POST" | "PATCH" | "DELETE" = "POST") {
  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: jsonHeaders(),
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const body = await res.json();
  return { status: res.status, body };
}

test("GET /api/status matches statusResponseSchema", async () => {
  const { status, body } = await getJson("/api/status");
  assert.equal(status, 200);
  statusResponseSchema.parse(body);
});

test("GET /api/auth/me matches authMeResponseSchema", async () => {
  const { status, body } = await getJson("/api/auth/me");
  assert.equal(status, 200);
  authMeResponseSchema.parse(body);
});

test("GET /api/preferences matches preferencesGetResponseSchema", async () => {
  const { status, body } = await getJson("/api/preferences");
  assert.equal(status, 200);
  preferencesGetResponseSchema.parse(body);
});

test("PATCH /api/preferences matches preferencesUpdateResponseSchema", async () => {
  const { status, body } = await postJson("/api/preferences", { notifyDigest: false }, "PATCH");
  assert.equal(status, 200);
  const parsed = preferencesUpdateResponseSchema.parse(body);
  assert.equal(parsed.data.preferences.notifyDigest, false);
});

test("POST /api/feedback matches feedbackCreateResponseSchema", async () => {
  const { status, body } = await postJson("/api/feedback", { message: "contract test feedback" });
  assert.equal(status, 200);
  feedbackCreateResponseSchema.parse(body);
});

test("GET /api/companies/search matches companySearchResponseSchema (PostgreSQL, no network)", async () => {
  const { status, body } = await getJson("/api/companies/search?q=%E8%85%BE%E8%AE%AF"); // 腾讯
  assert.equal(status, 200);
  companySearchResponseSchema.parse(body);
});

test("portfolio: upsert / list / review / snapshots / delete round-trip", async () => {
  const ticker = "TESTUS";

  const upsert = await postJson("/api/portfolio", {
    ticker, companyName: "Contract Test Co", shares: 100, avgCost: 10
  });
  assert.equal(upsert.status, 200);
  const upsertParsed = portfolioUpsertResponseSchema.parse(upsert.body);
  assert.equal(upsertParsed.data.position.ticker, ticker.toUpperCase() === ticker ? ticker : ticker);

  const list = await getJson("/api/portfolio");
  assert.equal(list.status, 200);
  const listParsed = portfolioListResponseSchema.parse(list.body);
  assert.ok(listParsed.data.positions.some((p) => p.ticker.toUpperCase().startsWith("TESTUS")));

  const review = await getJson("/api/portfolio/review");
  assert.equal(review.status, 200);
  portfolioReviewResponseSchema.parse(review.body);

  const snapshots = await getJson("/api/portfolio/snapshots");
  assert.equal(snapshots.status, 200);
  portfolioSnapshotsResponseSchema.parse(snapshots.body);

  const del = await postJson(`/api/portfolio?ticker=${ticker}`, undefined, "DELETE");
  assert.equal(del.status, 200);
  portfolioDeleteResponseSchema.parse(del.body);
});

test("notifications: list / unread / mark-all-read", async () => {
  const list = await getJson("/api/notifications");
  assert.equal(list.status, 200);
  notificationsListResponseSchema.parse(list.body);

  const unread = await getJson("/api/notifications/unread");
  assert.equal(unread.status, 200);
  notificationsUnreadResponseSchema.parse(unread.body);

  const read = await postJson("/api/notifications/read", { all: true });
  assert.equal(read.status, 200);
  notificationsReadResponseSchema.parse(read.body);
});

test("GET /api/scheduler/status matches schedulerStatusResponseSchema", async () => {
  const { status, body } = await getJson("/api/scheduler/status");
  assert.equal(status, 200);
  schedulerStatusResponseSchema.parse(body);
});

test("watch: track / untrack round-trip", async () => {
  const ticker = "WATCHTEST";
  const track = await postJson("/api/watch/track", { ticker, name: "Watch Test Co" });
  assert.equal(track.status, 200);
  watchTrackResponseSchema.parse(track.body);

  const untrack = await postJson("/api/watch/untrack", { ticker });
  assert.equal(untrack.status, 200);
  watchUntrackResponseSchema.parse(untrack.body);
});

test("GET /api/company/profiles matches profileListResponseSchema (empty on fresh DB)", async () => {
  const { status, body } = await getJson("/api/company/profiles");
  assert.equal(status, 200);
  const parsed = profileListResponseSchema.parse(body);
  assert.equal(parsed.data.count, parsed.data.profiles.length);
});

test("GET /api/research/scorecard matches researchScorecardResponseSchema (empty on fresh DB)", async () => {
  const { status, body } = await getJson("/api/research/scorecard");
  assert.equal(status, 200);
  researchScorecardResponseSchema.parse(body);
});

test("research sessions: list / conversations / clear", async () => {
  const list = await getJson("/api/research/sessions");
  assert.equal(list.status, 200);
  sessionListResponseSchema.parse(list.body);

  const conversations = await getJson("/api/research/conversations");
  assert.equal(conversations.status, 200);
  conversationListResponseSchema.parse(conversations.body);

  const cleared = await postJson("/api/research/sessions", undefined, "DELETE");
  assert.equal(cleared.status, 200);
  sessionClearResponseSchema.parse(cleared.body);
});

test("GET /api/hk-financials matches hkFinancialsListResponseSchema (PostgreSQL read, no ingest)", async () => {
  const { status, body } = await getJson("/api/hk-financials?ticker=0700.HK");
  assert.equal(status, 200);
  const parsed = hkFinancialsListResponseSchema.parse(body);
  assert.ok(Array.isArray(parsed.data.rows));
});
