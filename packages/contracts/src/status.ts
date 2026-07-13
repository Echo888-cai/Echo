/**
 * System status contract — GET /api/status.
 *
 * Not wrapped in the sendOk envelope (uses sendJson directly). Best-effort shape;
 * many sub-objects (canary, llmAudit, factGuard, hkFilingCoverage) are optional/loose
 * since they degrade to [] / null when their backing tables haven't been touched yet.
 */
import { z } from "zod";

export const statusSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["ok", "limited"]),
  detail: z.string()
});

export const statusResponseSchema = z.object({
  sources: z.array(statusSourceSchema),
  evidenceBacklog: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      priority: z.string(),
      providers: z.array(z.string())
    })
  ),
  ai: z.record(z.string(), z.unknown()),
  db: z.object({ companies: z.string() }),
  canary: z.object({
    batchId: z.union([z.string(), z.number()]).nullable(),
    sources: z.array(z.record(z.string(), z.unknown()))
  }),
  hkFilingCoverage: z.unknown().nullable(),
  llmAudit: z.array(z.record(z.string(), z.unknown())),
  usage: z.record(z.string(), z.unknown()),
  factGuard: z.record(z.string(), z.unknown()).nullable(),
  updatedAt: z.string()
});
