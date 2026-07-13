/**
 * Contract for src/server/routes/reports.js — POST /api/report/generate.
 * Not enveloped (sendJson directly). Deep-research pipeline; loose/best-effort shape.
 */
import { z } from "zod";
import { flatErrorSchema } from "./envelope.js";

export const reportGenerateRequestSchema = z
  .object({
    question: z.string(),
    company: z.object({ ticker: z.string() }).catchall(z.unknown()).optional(),
    history: z.array(z.unknown()).optional(),
    sessionId: z.string().optional(),
    conversationId: z.string().optional()
  })
  .catchall(z.unknown());

export const reportGenerateResponseSchema = z
  .object({
    mode: z.enum(["report_model", "report_local"]),
    provider: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    sessionId: z.string().nullable(),
    decisionPanel: z.unknown().nullable(),
    markdown: z.string(),
    preview: z.unknown().optional(),
    dataSources: z.unknown().optional(),
    marketSnapshot: z.unknown().optional(),
    newsSnapshot: z.unknown().optional(),
    webEvidence: z.unknown().optional(),
    factGuard: z
      .object({ repaired: z.boolean(), degraded: z.boolean() })
      .catchall(z.unknown())
      .nullable(),
    portrait: z
      .object({
        ticker: z.string(),
        created: z.boolean(),
        changed: z.boolean(),
        turnCount: z.number()
      })
      .nullable()
  })
  .catchall(z.unknown());

export const reportGenerateErrorResponseSchema = flatErrorSchema;
