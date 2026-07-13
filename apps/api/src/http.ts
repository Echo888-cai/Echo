import { randomUUID } from "node:crypto";

export function apiOk<T>(data: T) {
  return { ok: true as const, data, meta: { requestId: randomUUID(), asOf: new Date().toISOString() } };
}

export function apiError(code: string | number, message: string, details?: unknown) {
  return { ok: false as const, error: { code, message, ...(details === undefined ? {} : { details }) }, meta: { requestId: randomUUID() } };
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(request: Request, path: string) {
  const heavy = /\/api\/(ask|chat|report\/generate|parse-document)/.test(path);
  const limit = heavy ? 30 : 300;
  const windowMs = 60_000;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const key = `${ip}:${heavy ? "heavy" : "normal"}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  bucket.count += 1;
  return bucket.count > limit ? { status: 429, message: "请求过于频繁，请稍后再试" } : null;
}
