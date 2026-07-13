import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { closeDatabase } from "./context.js";
import * as preferencesRepository from "./userPreferencesRepository.js";
import * as feedbackRepository from "./feedbackRepository.js";
import * as portfolioRepository from "./portfolioRepository.js";
import * as notificationsRepository from "./notificationsRepository.js";
import * as watchlistRepository from "./watchlistRepository.js";
import * as companyRepository from "./companyRepository.js";
import * as companyProfilesRepository from "./companyProfilesRepository.js";
import * as researchSessionsRepository from "./researchSessionsRepository.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const sql = postgres(connectionString, { max: 1 });
const userId = "__repository_integration__";

before(async () => {
  await sql`insert into users (id, username, pass_hash) values (${userId}, ${userId}, '!test') on conflict (id) do nothing`;
});

after(async () => {
  await sql`delete from notifications where user_id = ${userId}`;
  await sql`delete from feedback where user_id = ${userId}`;
  await sql`delete from portfolio_positions where user_id = ${userId}`;
  await sql`delete from profile_events where user_id = ${userId}`;
  await sql`delete from company_profiles where user_id = ${userId}`;
  await sql`delete from research_sessions where user_id = ${userId}`;
  await sql`delete from watchlist_prefs where user_id = ${userId}`;
  await sql`delete from user_preferences where user_id = ${userId}`;
  await sql`delete from market_snapshots where ticker = 'PGTEST'`;
  await sql`delete from companies where ticker = 'PGTEST'`;
  await sql`delete from users where id = ${userId}`;
  await closeDatabase();
  await sql.end();
});

test("Drizzle repositories preserve private CRUD contracts", async () => {
  const preferences = await preferencesRepository.updateUserPreferences(userId, { notifyDigest: false });
  assert.equal(preferences.notifyDigest, false);

  const feedbackId = await feedbackRepository.insertFeedback(userId, "postgres feedback", { source: "test" });
  assert.ok(feedbackId > 0);
  assert.equal(((await feedbackRepository.listFeedback(userId))[0]?.context as { source?: string })?.source, "test");

  const position = await portfolioRepository.upsertPosition("PGTEST", { shares: 10, avgCost: 2 }, userId);
  assert.equal(position?.shares, 10);
  assert.equal((await portfolioRepository.listPositions(userId)).length, 1);

  const notification = await notificationsRepository.insertNotification({ kind: "system", title: "test", dedupeKey: "pg-test", userId });
  assert.ok(notification?.id);
  assert.equal(await notificationsRepository.unreadCount(userId), 1);
  await notificationsRepository.markAllRead(userId);
  assert.equal(await notificationsRepository.unreadCount(userId), 0);

  assert.equal(await watchlistRepository.addToWatch("PGTEST", "PG Test", userId), true);
  assert.equal((await watchlistRepository.listWatchAdds(userId))[0]?.ticker, "PGTEST");
  assert.equal(await watchlistRepository.removeFromWatch("PGTEST", userId), true);
  assert.ok((await watchlistRepository.getHiddenTickers(userId)).has("PGTEST"));

  const matches = await companyRepository.searchCompanies("PGTEST");
  assert.equal(matches[0]?.ticker, "PGTEST");
  const company = await companyRepository.getCompanyByTickerComplete("PGTEST");
  assert.equal(company?.nameZh, "PGTEST");
  await companyRepository.saveMarketSnapshot({ ticker: "PGTEST", price: "12.34", source: "integration" });
  assert.equal((await companyRepository.getLatestMarketSnapshot("PGTEST"))?.price, 12.34);

  const profile = await companyProfilesRepository.upsertCompanyProfile("PGTEST", {
    companyName: "PG Test",
    thesis: "contract thesis",
    valuation: { method: "PE", bear: "10", base: "12", bull: "15", currentPrice: "12.34" },
    event: { date: "2026-07-13", kind: "created", summary: "profile created" },
    bumpTurn: true
  }, userId);
  assert.equal(profile?.valuation?.base, 12);
  assert.equal(profile?.events[0]?.summary, "profile created");
  assert.match(profile?.profileMd || "", /contract thesis/);

  const first = await researchSessionsRepository.saveResearchSession({
    ticker: "PGTEST", title: "first", question: "q1", thread: [{ role: "user", content: "q1" }]
  }, userId);
  await researchSessionsRepository.saveResearchSession({
    ticker: "PGTEST", title: "second", question: "q2", conversationId: first.id
  }, userId);
  assert.equal((await researchSessionsRepository.getResearchSession(first.id, userId))?.turnCount, 1);
  const conversations = await researchSessionsRepository.listConversations({ userId });
  assert.equal(conversations[0]?.sessions.length, 2);
  assert.equal(conversations[0]?.companies[0]?.ticker, "PGTEST");
});
