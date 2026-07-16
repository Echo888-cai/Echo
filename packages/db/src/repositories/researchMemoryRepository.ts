import { and, eq, gte, isNull, lte, asc, desc } from "drizzle-orm";
import { researchFacts, researchQuestions, reviewDates } from "../schema/research_memory.js";
import { withTenant } from "./context.js";

export async function addFact(
  userId: string, ticker: string, fact: string, source?: string, sessionId?: string
) {
  return withTenant(userId, async (tx) => {
    const [saved] = await tx.insert(researchFacts).values({
      userId, ticker, fact, source: source || null,
      sessionId: sessionId || null, validFrom: new Date()
    }).returning();
    return saved;
  });
}

export async function listFacts(ticker: string, userId: string) {
  return withTenant(userId, async (tx) =>
    tx.select().from(researchFacts).where(
      and(
        eq(researchFacts.userId, userId),
        eq(researchFacts.ticker, ticker),
        isNull(researchFacts.supersededBy)
      )
    ).orderBy(desc(researchFacts.createdAt))
  );
}

export async function supersedeFact(factId: number, newFactId: number, userId: string) {
  return withTenant(userId, async (tx) => {
    const [updated] = await tx.update(researchFacts)
      .set({ supersededBy: newFactId })
      .where(and(eq(researchFacts.id, factId), eq(researchFacts.userId, userId)))
      .returning();
    return updated || null;
  });
}

export async function addQuestion(
  userId: string, ticker: string, question: string, sessionId?: string
) {
  return withTenant(userId, async (tx) => {
    const [saved] = await tx.insert(researchQuestions).values({
      userId, ticker, question, sessionId: sessionId || null
    }).returning();
    return saved;
  });
}

export async function listQuestions(ticker: string, userId: string, status?: string) {
  return withTenant(userId, async (tx) => {
    const conditions = [
      eq(researchQuestions.userId, userId),
      eq(researchQuestions.ticker, ticker)
    ];
    if (status) conditions.push(eq(researchQuestions.status, status));
    return tx.select().from(researchQuestions)
      .where(and(...conditions))
      .orderBy(desc(researchQuestions.createdAt));
  });
}

export async function resolveQuestion(questionId: number, answer: string, userId: string) {
  return withTenant(userId, async (tx) => {
    const [updated] = await tx.update(researchQuestions)
      .set({ status: "resolved", answer, resolvedAt: new Date() })
      .where(and(eq(researchQuestions.id, questionId), eq(researchQuestions.userId, userId)))
      .returning();
    return updated || null;
  });
}

export async function addReviewDate(
  userId: string, ticker: string, date: string, reason?: string
) {
  return withTenant(userId, async (tx) => {
    const [saved] = await tx.insert(reviewDates).values({
      userId, ticker, reviewDate: date, reason: reason || null
    }).returning();
    return saved;
  });
}

export async function listUpcomingReviews(userId: string, daysAhead = 7) {
  const today = new Date();
  const future = new Date(today);
  future.setDate(future.getDate() + daysAhead);
  const todayStr = today.toISOString().slice(0, 10);
  const futureStr = future.toISOString().slice(0, 10);
  return withTenant(userId, async (tx) =>
    tx.select().from(reviewDates).where(
      and(
        eq(reviewDates.userId, userId),
        eq(reviewDates.completed, false),
        gte(reviewDates.reviewDate, todayStr),
        lte(reviewDates.reviewDate, futureStr)
      )
    ).orderBy(asc(reviewDates.reviewDate))
  );
}

export async function completeReview(reviewId: number, userId: string) {
  return withTenant(userId, async (tx) => {
    const [updated] = await tx.update(reviewDates)
      .set({ completed: true })
      .where(and(eq(reviewDates.id, reviewId), eq(reviewDates.userId, userId)))
      .returning();
    return updated || null;
  });
}
