/**
 * Contract for src/server/routes/discover.js — POST /api/discover.
 * Not enveloped (sendJson directly). Delegates to services/discovery.js runScreener()/runMacro().
 */
import { z } from "zod";

export const discoverRequestSchema = z.object({
  question: z.string(),
  kind: z.enum(["screener", "macro"]).optional()
});

/** services/discovery.js runScreener() return value. */
export const screenerResponseSchema = z.object({
  kind: z.literal("screener"),
  filters: z.record(z.string(), z.unknown()),
  rows: z.array(z.record(z.string(), z.unknown())),
  notes: z.array(z.string()).optional()
});

/** services/discovery.js runMacro() return value. */
export const macroResponseSchema = z.object({
  kind: z.literal("macro"),
  content: z.string(),
  mode: z.enum(["model", "local_fallback"]),
  indices: z.array(z.unknown()),
  evidence: z.array(
    z.object({
      title: z.string().optional(),
      url: z.string().optional(),
      source: z.string().optional(),
      type: z.string(),
      cred: z.number().nullable(),
      date: z.string()
    })
  ),
  gaps: z.array(z.unknown())
});

export const discoverResponseSchema = z.union([screenerResponseSchema, macroResponseSchema]);

export const discoverErrorResponseSchema = z.object({ error: z.string() });
