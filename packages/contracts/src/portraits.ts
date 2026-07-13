/**
 * Contracts for src/server/routes/portraits.js.
 *
 *   GET    /api/company/profiles        → {profiles, count}
 *   GET    /api/company/profile?ticker= → {profile, markdown}
 *   DELETE /api/company/profile?ticker= → {deleted, ticker}
 *   GET    /api/company/review?ticker=  → {ticker, scorecard}
 *   GET    /api/research/scorecard      → {global, perTicker}
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

/** Mirrors repositories/companyProfilesRepository.js listCompanyProfiles() (summary row). */
export const profileSummarySchema = z.object({
  ticker: z.string(),
  companyName: z.string(),
  thesis: z.string(),
  researchStatus: z.string(),
  confidence: z.string(),
  turnCount: z.number(),
  updatedAt: z.string()
});
export const profileListResponseSchema = okEnvelope(
  z.object({ profiles: z.array(profileSummarySchema), count: z.number() })
);

const profileEventSchema = z.object({
  date: z.string(),
  kind: z.string(),
  summary: z.string(),
  rationale: z.string(),
  evidence: z.array(z.unknown()),
  sessionId: z.string().nullable()
});

/** Mirrors repositories/companyProfilesRepository.js hydrate() (full profile). */
export const companyProfileSchema = z.object({
  ticker: z.string(),
  companyName: z.string(),
  thesis: z.string(),
  researchStatus: z.string(),
  confidence: z.string(),
  bull: z.array(z.unknown()),
  bear: z.array(z.unknown()),
  monitors: z.array(z.unknown()),
  falsifiers: z.array(z.unknown()),
  valuation: z.unknown().nullable(),
  events: z.array(profileEventSchema),
  profileMd: z.string(),
  turnCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const profileGetResponseSchema = okEnvelope(
  z.object({ profile: companyProfileSchema, markdown: z.string() })
);

export const profileDeleteResponseSchema = okEnvelope(
  z.object({ deleted: z.literal(true), ticker: z.string() })
);

/** services/researchReview.js computeTickerScorecard() — loose (either "insufficient sample"
 *  message shape or the full-stats shape; both share reviews/totalSnapshots/matureSampleSize). */
export const tickerScorecardSchema = z
  .object({
    totalSnapshots: z.number(),
    matureSampleSize: z.number(),
    insufficientSample: z.boolean(),
    reviews: z.array(z.unknown()),
    message: z.string().optional(),
    withinBandRate: z.number().optional(),
    towardBaseRate: z.number().nullable().optional(),
    falsifierBreaches: z.number().optional(),
    postEarningsSampleSize: z.number().optional(),
    epsBeatRate: z.number().nullable().optional()
  });

export const profileReviewResponseSchema = okEnvelope(
  z.object({ ticker: z.string(), scorecard: tickerScorecardSchema })
);

export const globalScorecardSchema = z.object({
  tickerCount: z.number(),
  matureSampleSize: z.number(),
  insufficientSample: z.boolean(),
  message: z.string().optional(),
  withinBandRate: z.number().optional(),
  towardBaseRate: z.number().nullable().optional(),
  postEarningsSampleSize: z.number().optional(),
  epsBeatRate: z.number().nullable().optional()
});

export const researchScorecardResponseSchema = okEnvelope(
  z.object({
    global: globalScorecardSchema,
    perTicker: z.array(z.object({ ticker: z.string(), scorecard: tickerScorecardSchema }))
  })
);
