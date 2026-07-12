/**
 * Contracts for src/server/routes/hkFinancials.js.
 *
 *   GET  /api/hk-financials?ticker=&limit=          → {ticker, rows}
 *   POST /api/hk-financials/ingest?ticker=&limit=&force= → {ticker, ingested, skipped, errors}
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

export const hkFinancialsListQuerySchema = z.object({
  ticker: z.string(),
  limit: z.string().optional()
});

/** hk_financials table row — raw (snake_case, not hydrated by the repository). */
export const hkFinancialsRowSchema = z.record(z.string(), z.unknown());

export const hkFinancialsListResponseSchema = okEnvelope(
  z.object({ ticker: z.string(), rows: z.array(hkFinancialsRowSchema) })
);

export const hkFinancialsIngestQuerySchema = z.object({
  ticker: z.string(),
  limit: z.string().optional(),
  force: z.string().optional()
});

export const hkFinancialsIngestResponseSchema = okEnvelope(
  z.object({
    ticker: z.string(),
    ingested: z.array(z.unknown()),
    skipped: z.array(z.string()),
    errors: z.array(z.unknown())
  })
);
