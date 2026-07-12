/**
 * Shared response envelope — mirrors src/server/utils/async.js.
 *
 * Most routes reply through sendOk/sendError, which wrap the payload in a
 * standard envelope:
 *   ok: true  → { ok: true, data: T, meta: { requestId, asOf, ... } }
 *   ok: false → { ok: false, error: { code, message, details? }, meta: { requestId } }
 *
 * A handful of older routes (ask/chat/discover/report/status) write JSON
 * directly via sendJson and do NOT use this envelope — those contracts model
 * the flat body they actually send instead of wrapping it here.
 */
import { z } from "zod";

export const apiMetaSchema = z
  .object({
    requestId: z.string(),
    asOf: z.string().optional()
  })
  .catchall(z.unknown());

export function okEnvelope<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    ok: z.literal(true),
    data: dataSchema,
    meta: apiMetaSchema
  });
}

export const apiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.union([z.string(), z.number()]),
    message: z.string(),
    details: z.unknown().optional()
  }),
  meta: z.object({ requestId: z.string() }).catchall(z.unknown())
});

/** Flat (non-enveloped) success shape used by ask/chat/discover/report/status handlers. */
export function flatOk<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape);
}

/** Flat error shape used by the sendJson(res, status, { error }) handlers (ask/chat/discover/report). */
export const flatErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  usage: z.unknown().optional()
});
