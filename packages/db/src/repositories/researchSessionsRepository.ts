import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { companies } from "../schema/core.js";
import { researchSessions } from "../schema/research.js";
import { withTenant } from "./context.js";

function session(row: typeof researchSessions.$inferSelect | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    ticker: row.ticker,
    title: row.title || row.question,
    question: row.question,
    conversationId: row.conversationId || row.id,
    status: row.status,
    reportMarkdown: row.reportMarkdown,
    rating: row.rating,
    confidence: row.confidence,
    decisionPanel: row.decisionPanel || null,
    fullResearch: row.fullResearch,
    dataSources: row.dataSources || null,
    thread: row.threadJson || null,
    turnCount: row.turnCount || 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function ensureCompany(tx: any, ticker: string, name?: string) {
  const isUs = !ticker.endsWith(".HK") && !/\.(SS|SZ)$/.test(ticker);
  await tx.insert(companies).values({
    ticker,
    nameZh: name || ticker,
    nameEn: isUs ? name || ticker : null,
    exchange: isUs ? "US" : ticker.endsWith(".HK") ? "HKEX" : "CN",
    currency: isUs ? "USD" : ticker.endsWith(".HK") ? "HKD" : "CNY"
  }).onConflictDoNothing();
}

export async function saveResearchSession(payload: any, userId = payload?.userId || "local") {
  if (!payload?.ticker) throw new Error("research_sessions 需要 ticker");
  const id = payload.id || payload.sessionId || `s_${randomUUID()}`;
  const thread = Array.isArray(payload.thread) ? payload.thread.slice(-80) : null;
  await withTenant(userId, async (tx) => {
    await ensureCompany(tx, payload.ticker, payload.companyName || payload.title);
    const [existing] = await tx.select().from(researchSessions)
      .where(and(eq(researchSessions.userId, userId), eq(researchSessions.id, id))).limit(1);
    const values = {
      userId,
      ticker: payload.ticker,
      title: payload.title || payload.sessionTitle || payload.question || existing?.title || "",
      question: payload.question || existing?.question || "",
      conversationId: existing?.conversationId || payload.conversationId || id,
      status: payload.status || "completed",
      reportMarkdown: payload.reportMarkdown || null,
      rating: payload.researchStatus || payload.rating || null,
      confidence: payload.confidence || null,
      decisionPanel: payload.decisionPanel || null,
      fullResearch: payload.fullResearch || null,
      dataSources: payload.dataSources || null,
      threadJson: thread || existing?.threadJson || null,
      turnCount: Number.isFinite(payload.turnCount)
        ? payload.turnCount
        : thread
          ? thread.filter((message: any) => message?.role === "user").length
          : existing?.turnCount ?? null,
      updatedAt: new Date()
    };
    if (existing) {
      await tx.update(researchSessions).set(values)
        .where(and(eq(researchSessions.userId, userId), eq(researchSessions.id, id)));
    } else {
      await tx.insert(researchSessions).values({ id, ...values });
    }
  });
  return { id };
}

export async function getResearchSession(id: string, userId = "local") {
  return withTenant(userId, async (tx) => session((await tx.select().from(researchSessions)
    .where(and(eq(researchSessions.userId, userId), eq(researchSessions.id, id))).limit(1))[0]));
}

export async function listResearchSessions({ limit = 20, ticker, userId = "local" }: { limit?: number; ticker?: string; userId?: string } = {}) {
  return withTenant(userId, async (tx) => {
    const where = ticker
      ? and(eq(researchSessions.userId, userId), eq(researchSessions.ticker, ticker))
      : eq(researchSessions.userId, userId);
    const rows = await tx.select({ session: researchSessions, companyName: companies.nameZh })
      .from(researchSessions).leftJoin(companies, eq(companies.ticker, researchSessions.ticker))
      .where(where).orderBy(desc(researchSessions.updatedAt), desc(researchSessions.id)).limit(limit);
    return rows.map(({ session: row, companyName }) => ({
      id: row.id,
      ticker: row.ticker,
      title: row.title,
      question: row.question,
      conversation_id: row.conversationId,
      status: row.status,
      rating: row.rating,
      confidence: row.confidence,
      turn_count: row.turnCount,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      company_name: companyName
    }));
  });
}

export async function listConversations({ limit = 20, userId = "local" }: { limit?: number; userId?: string } = {}) {
  return withTenant(userId, async (tx) => {
    const rows = await tx.select({ session: researchSessions, companyName: companies.nameZh })
      .from(researchSessions).leftJoin(companies, eq(companies.ticker, researchSessions.ticker))
      .where(eq(researchSessions.userId, userId))
      .orderBy(asc(researchSessions.createdAt), asc(researchSessions.id));
    const groups = new Map<string, any>();
    for (const { session: row, companyName } of rows) {
      const conversationId = row.conversationId || row.id;
      let group = groups.get(conversationId);
      if (!group) {
        group = {
          conversationId,
          title: row.title || row.question || companyName || row.ticker,
          updatedAt: row.updatedAt.toISOString(),
          lastOrder: `${row.createdAt.toISOString()}\0${row.id}`,
          sessions: []
        };
        groups.set(conversationId, group);
      }
      const updatedAt = row.updatedAt.toISOString();
      const order = `${row.createdAt.toISOString()}\0${row.id}`;
      if (updatedAt >= group.updatedAt) {
        group.updatedAt = updatedAt;
        group.lastOrder = order;
      }
      group.sessions.push({
        id: row.id,
        ticker: row.ticker,
        companyName: companyName || row.ticker,
        title: row.title || row.question || row.ticker,
        status: row.status,
        rating: row.rating,
        confidence: row.confidence,
        turnCount: row.turnCount || 0,
        createdAt: row.createdAt.toISOString(),
        updatedAt
      });
    }
    return [...groups.values()].map((group) => {
      const companiesSeen = new Set<string>();
      const companyList: Array<{ ticker: string; name: string }> = [];
      for (const item of group.sessions) {
        if (item.ticker && !companiesSeen.has(item.ticker)) {
          companiesSeen.add(item.ticker);
          companyList.push({ ticker: item.ticker, name: item.companyName });
        }
      }
      return { ...group, companies: companyList };
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.lastOrder.localeCompare(a.lastOrder))
      .slice(0, limit).map(({ lastOrder: _lastOrder, ...group }) => group);
  });
}

export async function deleteResearchSession(id: string, userId = "local") {
  return withTenant(userId, async (tx) => (await tx.delete(researchSessions)
    .where(and(eq(researchSessions.userId, userId), eq(researchSessions.id, id)))
    .returning({ id: researchSessions.id })).length > 0);
}

export async function clearResearchSessions(userId = "local") {
  return withTenant(userId, async (tx) => (await tx.delete(researchSessions)
    .where(eq(researchSessions.userId, userId)).returning({ id: researchSessions.id })).length);
}
