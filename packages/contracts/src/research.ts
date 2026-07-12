/**
 * Contracts for src/server/routes/research.js (research session / conversation routes).
 * Note: handleSessionMemo (POST /api/research/sessions/:id/memo) is exported but NOT wired
 * in server.js, so it's omitted here.
 *
 *   GET    /api/research/conversations       → {conversations, count}
 *   GET    /api/research/sessions            → {sessions, count}
 *   DELETE /api/research/sessions            → {deleted, cleared}
 *   GET    /api/research/sessions/:id        → {session, report}
 *   DELETE /api/research/sessions/:id        → {deleted, sessionId}
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

export const sessionListQuerySchema = z.object({
  ticker: z.string().optional(),
  limit: z.string().optional()
});

/** Mirrors research.js handleSessionList's mapped row (listResearchSessions() raw row + derived fields). */
export const sessionSummarySchema = z
  .object({
    id: z.string(),
    ticker: z.string(),
    title: z.string(),
    preview: z.string(),
    companyName: z.string(),
    turnCount: z.number(),
    question: z.string().nullable().optional(),
    conversation_id: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    rating: z.string().nullable().optional(),
    confidence: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional()
  })
  .catchall(z.unknown());

export const sessionListResponseSchema = okEnvelope(
  z.object({ sessions: z.array(sessionSummarySchema), count: z.number() })
);

const conversationSessionSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  companyName: z.string(),
  title: z.string(),
  status: z.string().nullable(),
  rating: z.string().nullable(),
  confidence: z.string().nullable(),
  turnCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string()
});

/** Mirrors repositories/researchSessions.js listConversations(). */
export const conversationGroupSchema = z.object({
  conversationId: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  sessions: z.array(conversationSessionSchema),
  companies: z.array(z.object({ ticker: z.string(), name: z.string() }))
});

export const conversationListResponseSchema = okEnvelope(
  z.object({ conversations: z.array(conversationGroupSchema), count: z.number() })
);

export const sessionClearResponseSchema = okEnvelope(
  z.object({ deleted: z.number(), cleared: z.literal(true) })
);

/** Mirrors repositories/researchSessions.js getResearchSession(). */
export const researchSessionSchema = z.object({
  id: z.string(),
  ticker: z.string(),
  title: z.string().nullable(),
  question: z.string().nullable(),
  conversationId: z.string(),
  status: z.string(),
  reportMarkdown: z.string().nullable(),
  rating: z.string().nullable(),
  confidence: z.string().nullable(),
  decisionPanel: z.unknown().nullable(),
  fullResearch: z.string().nullable(),
  dataSources: z.unknown().nullable(),
  thread: z.array(z.unknown()).nullable(),
  turnCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const sessionGetResponseSchema = okEnvelope(
  z.object({
    session: researchSessionSchema,
    // services/reportComposer.js composeReport() output — best-effort.
    report: z.object({ markdown: z.string() }).catchall(z.unknown()).nullable()
  })
);

export const sessionDeleteResponseSchema = okEnvelope(
  z.object({ deleted: z.literal(true), sessionId: z.string() })
);
