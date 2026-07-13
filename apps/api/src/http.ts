import { randomUUID } from "node:crypto";
import { incrementRateLimitBucket } from "@echo/db/repositories/rateLimitRepository.js";

export function apiOk<T>(data: T) {
  return { ok: true as const, data, meta: { requestId: randomUUID(), asOf: new Date().toISOString() } };
}

export function apiError(code: string | number, message: string, details?: unknown) {
  return { ok: false as const, error: { code, message, ...(details === undefined ? {} : { details }) }, meta: { requestId: randomUUID() } };
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const SWEEP_THRESHOLD = 5_000;

// Normal-path limiter stays in-process (approximate per replica, cheap, no DB round trip).
// It only guards against runaway clients, not billable abuse, so per-instance drift is acceptable.
function sweepExpired(now: number) {
  if (buckets.size < SWEEP_THRESHOLD) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function normalPathLimit(ip: string, now: number, windowMs: number, limit: number) {
  const key = `${ip}:normal`;
  sweepExpired(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  bucket.count += 1;
  return bucket.count > limit ? { status: 429, message: "请求过于频繁，请稍后再试" } : null;
}

// Heavy paths (ask/report-generate/parse-document) can incur real provider cost, so the
// count must be exact and shared across every API replica — backed by Postgres, not a
// per-process Map. See packages/db/src/repositories/rateLimitRepository.ts.
async function heavyPathLimit(ip: string, windowMs: number, limit: number) {
  const count = await incrementRateLimitBucket(`${ip}:heavy`, windowMs);
  return count > limit ? { status: 429, message: "请求过于频繁，请稍后再试" } : null;
}

export async function rateLimit(request: Request, path: string) {
  const heavy = /\/api\/(ask|chat|report\/generate|parse-document)/.test(path);
  const windowMs = 60_000;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return heavy ? heavyPathLimit(ip, windowMs, 30) : normalPathLimit(ip, Date.now(), windowMs, 300);
}
