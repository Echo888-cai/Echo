/**
 * Contracts for src/server/routes/portfolio.js.
 *
 *   GET    /api/portfolio            → {positions}
 *   GET    /api/portfolio/review     → {review}
 *   GET    /api/portfolio/snapshots  → {snapshots}
 *   POST   /api/portfolio            → {position}
 *   DELETE /api/portfolio?ticker=    → {deleted, ticker}
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

/** Mirrors repositories/portfolioRepository.js hydrate() + services/portfolioEnrich.js enrichPosition(). */
export const portfolioPositionSchema = z.object({
  ticker: z.string(),
  companyName: z.string(),
  shares: z.number().nullable(),
  avgCost: z.number().nullable(),
  stopLoss: z.number().nullable(),
  takeProfit: z.number().nullable(),
  note: z.string(),
  updatedAt: z.string(),
  currentPrice: z.number().nullable(),
  currency: z.string().nullable(),
  asOf: z.string().nullable(),
  priceStatus: z.enum(["ok", "missing"]),
  changePct: z.number().nullable(),
  returnPct: z.number().optional(),
  marketValue: z.number().optional(),
  costValue: z.number().optional(),
  unrealizedPnl: z.number().optional(),
  toStopPct: z.number().optional(),
  toTakePct: z.number().optional(),
  sector: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  falsifierRuleCount: z.number(),
  nearestFalsifierRule: z
    .object({
      ruleId: z.union([z.string(), z.number()]),
      label: z.string().nullable().optional(),
      kind: z.string().nullable().optional(),
      threshold: z.number().nullable().optional(),
      distancePct: z.number(),
      triggered: z.boolean()
    })
    .nullable(),
  nextEarnings: z.object({ date: z.string(), daysToEarnings: z.number() }).nullable()
});

export const portfolioListResponseSchema = okEnvelope(
  z.object({ positions: z.array(portfolioPositionSchema) })
);

/** services/portfolioReview.js computePortfolioReview() — loosely typed, best-effort. */
export const portfolioReviewSchema = z.object({
  positionCount: z.number(),
  totals: z.array(z.unknown()),
  weights: z.array(z.unknown()),
  marketExposure: z.record(z.string(), z.unknown()),
  sectorWeights: z.array(z.unknown()),
  checks: z.array(z.unknown()),
  verdict: z.string()
});
export const portfolioReviewResponseSchema = okEnvelope(z.object({ review: portfolioReviewSchema }));

/** services/portfolioSnapshot.js / repositories/portfolioSnapshotsRepository.js listSnapshots() rows — best-effort. */
export const portfolioSnapshotRowSchema = z.record(z.string(), z.unknown());
export const portfolioSnapshotsResponseSchema = okEnvelope(
  z.object({ snapshots: z.array(portfolioSnapshotRowSchema) })
);

export const portfolioUpsertRequestSchema = z.object({
  ticker: z.string(),
  companyName: z.string().optional(),
  shares: z.union([z.number(), z.string()]).optional(),
  avgCost: z.union([z.number(), z.string()]).optional(),
  stopLoss: z.union([z.number(), z.string()]).optional(),
  takeProfit: z.union([z.number(), z.string()]).optional(),
  note: z.string().optional()
});
export const portfolioUpsertResponseSchema = okEnvelope(z.object({ position: portfolioPositionSchema }));

export const portfolioDeleteResponseSchema = okEnvelope(
  z.object({ deleted: z.literal(true), ticker: z.string() })
);
