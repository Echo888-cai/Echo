/**
 * Contract for src/server/routes/chat.js — POST /api/chat.
 *
 * Not enveloped (sendJson directly). Delegates to services/chatOrchestrator.js runChat(),
 * which can respond either as a single JSON object (finalizeChat() return value, modeled
 * below) or as an SSE stream (text/event-stream) — the SSE path isn't representable as a
 * JSON response schema and isn't contracted here. Deeply nested fields (decisionPanel,
 * valuation, webEvidence, etc.) are intentionally loose: they come from LLM + market-data
 * pipelines, not a fixed DB shape.
 */
import { z } from "zod";
import { flatErrorSchema } from "./envelope.js";

export const chatRequestSchema = z
  .object({
    question: z.string(),
    company: z.object({ ticker: z.string() }).catchall(z.unknown()).optional(),
    history: z.array(z.unknown()).optional(),
    sessionId: z.string().optional(),
    conversationId: z.string().optional()
  })
  .catchall(z.unknown());

/** Mirrors chatOrchestrator.js finalizeChat() return value (non-streaming path only). */
export const chatResponseSchema = z
  .object({
    mode: z.enum(["chat_model", "chat_local"]),
    intent: z.unknown().optional(),
    provider: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    sessionId: z.string().nullable().optional(),
    content: z.string(),
    decisionPanel: z.unknown().nullable(),
    dataSources: z.unknown().optional(),
    marketSnapshot: z.unknown().optional(),
    newsSnapshot: z.unknown().optional(),
    valuation: z.unknown().nullable().optional(),
    portrait: z
      .object({
        ticker: z.string(),
        created: z.boolean(),
        changed: z.boolean(),
        turnCount: z.number()
      })
      .nullable()
      .optional()
  })
  .catchall(z.unknown());

export const chatErrorResponseSchema = flatErrorSchema;
