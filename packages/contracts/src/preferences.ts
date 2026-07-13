/**
 * Preferences and feedback contracts.
 *
 *   GET   /api/preferences        → {preferences}
 *   PATCH /api/preferences        → {preferences}
 *   POST  /api/feedback           → {id, received}
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

/** Mirrors repositories/userPreferencesRepository.js DEFAULTS/hydrate(). */
export const userPreferencesSchema = z.object({
  onboardingCompleted: z.boolean(),
  notifyDigest: z.boolean(),
  notifyPositions: z.boolean(),
  notifyFalsify: z.boolean(),
  notifyReview: z.boolean(),
  notifyEarnings: z.boolean()
});

export const preferencesGetResponseSchema = okEnvelope(z.object({ preferences: userPreferencesSchema }));

export const preferencesUpdateRequestSchema = z
  .object({
    onboardingCompleted: z.boolean().optional(),
    notifyDigest: z.boolean().optional(),
    notifyPositions: z.boolean().optional(),
    notifyFalsify: z.boolean().optional(),
    notifyReview: z.boolean().optional(),
    notifyEarnings: z.boolean().optional()
  })
  .partial();
export const preferencesUpdateResponseSchema = okEnvelope(z.object({ preferences: userPreferencesSchema }));

export const feedbackCreateRequestSchema = z.object({
  message: z.string(),
  context: z.record(z.string(), z.unknown()).nullable().optional()
});
export const feedbackCreateResponseSchema = okEnvelope(
  z.object({ id: z.union([z.number(), z.bigint()]), received: z.literal(true) })
);
