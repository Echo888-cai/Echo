/**
 * Event digest contract — GET /api/events/digest.
 * The output is
 * best-effort/loose (depends on live market + news data).
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

export const digestSchema = z.object({
  generatedAt: z.string(),
  slot: z.enum(["premarket", "afterhours"]),
  events: z.array(z.unknown()),
  groups: z.array(z.unknown()),
  failures: z.array(z.unknown()),
  counts: z.object({ high: z.number(), medium: z.number(), low: z.number() }),
  summary: z.string().optional()
});

export const eventsDigestResponseSchema = okEnvelope(
  z.object({ digest: digestSchema, tracked: z.number() })
);
