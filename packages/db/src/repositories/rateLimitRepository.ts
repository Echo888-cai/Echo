import { sql } from "drizzle-orm";
import { database } from "./context.js";

/** Atomically bumps (or opens) a fixed-window bucket and returns the count after
 * this request. One round trip, no read-then-write race: the window reset is
 * decided inside the same UPSERT that increments it. */
export async function incrementRateLimitBucket(key: string, windowMs: number) {
  const result = await database().execute(sql`
    INSERT INTO rate_limit_buckets (key, count, reset_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowMs / 1000}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_buckets.reset_at <= now() THEN 1 ELSE rate_limit_buckets.count + 1 END,
      reset_at = CASE WHEN rate_limit_buckets.reset_at <= now() THEN now() + make_interval(secs => ${windowMs / 1000}) ELSE rate_limit_buckets.reset_at END
    RETURNING count
  `);
  const [row] = Array.from(result) as { count: number }[];
  // 1/500 chance per call: opportunistic prune, no separate cron needed for a table this cheap to sweep.
  if (Math.random() < 0.002) {
    await database().execute(sql`DELETE FROM rate_limit_buckets WHERE reset_at < now() - interval '1 day'`);
  }
  return row?.count ?? 1;
}
