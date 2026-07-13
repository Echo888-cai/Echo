/**
 * Contracts for src/server/routes/companies.js — only the 3 handlers wired in
 * server.js (handleCompanyByTicker / handleCompanyHealth are exported but NOT
 * mounted, so they're skipped here).
 *
 *   GET /api/companies/search?q=      → {companies, total}
 *   GET /api/companies/verify?ticker= → {status, name?, suggestions?}
 *   GET /api/companies/resolve?q=     → {company} | {company:null, reason?, name?}
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

export const companySearchResultSchema = z.object({
  ticker: z.string(),
  nameZh: z.string().nullable(),
  nameEn: z.string().nullable(),
  sector: z.string().nullable(),
  industry: z.string().nullable(),
  hasPortrait: z.boolean()
});

export const companySearchResponseSchema = okEnvelope(
  z.object({ companies: z.array(companySearchResultSchema), total: z.number() })
);

export const companyVerifyResponseSchema = okEnvelope(
  z.object({
    status: z.enum(["verified", "not_found", "error"]),
    name: z.string().optional(),
    suggestions: z.array(z.object({ ticker: z.string(), name: z.string() })).optional()
  })
);

export const resolvedCompanySchema = z.object({
  ticker: z.string(),
  nameZh: z.string(),
  nameEn: z.string().optional(),
  industry: z.string().optional()
});

export const companyResolveResponseSchema = okEnvelope(
  z.object({
    company: resolvedCompanySchema.nullable(),
    reason: z.string().optional(),
    name: z.string().optional()
  })
);
