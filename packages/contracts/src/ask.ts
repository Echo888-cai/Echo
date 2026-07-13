/**
 * Contract for src/server/routes/ask.js — POST /api/ask.
 *
 * Unified entry point: server-side decides whether this is a company question
 * (delegates to chat's runChat — see chat.ts response shape / SSE) or a
 * screener/macro question (delegates to runDiscover — see discover.ts response shape).
 * Not enveloped (sendJson directly). No single fixed response schema exists for this
 * route since it fans out to two very different shapes depending on classification;
 * consumers should validate against chatResponseSchema OR the discover schemas.
 */
import { z } from "zod";
import { flatErrorSchema } from "./envelope.js";

export const askRequestSchema = z
  .object({
    question: z.string(),
    company: z.object({ ticker: z.string() }).catchall(z.unknown()).optional(),
    kind: z.enum(["company", "screener", "macro"]).optional(),
    compareWith: z.object({ ticker: z.string() }).catchall(z.unknown()).optional(),
    history: z.array(z.unknown()).optional(),
    sessionId: z.string().optional(),
    conversationId: z.string().optional()
  })
  .catchall(z.unknown());

export const askErrorResponseSchema = flatErrorSchema;
