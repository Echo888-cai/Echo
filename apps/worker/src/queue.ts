/**
 * queue.ts — Redis connection + BullMQ Queue for the Echo Research scheduler worker (R-2).
 *
 * This is a separately-deployable process: domain logic is untouched (imported from
 * src/server/services/scheduler.js), only the *trigger mechanism* moves from an
 * in-process setInterval tick loop to BullMQ repeatable jobs backed by Redis.
 */
import { Queue, type ConnectionOptions } from "bullmq";

export const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

/**
 * Connection options (not a live client): BullMQ instantiates its own ioredis client from
 * this per Queue/Worker. Passing options rather than a pre-built ioredis instance sidesteps
 * a real-world npm quirk — this workspace's top-level `ioredis` dep and bullmq's bundled
 * `ioredis` dep can resolve to two different installed versions, and TS then treats their
 * Redis classes as structurally incompatible types.
 */
export function createConnection(): ConnectionOptions {
  const url = new URL(REDIS_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    password: url.password || undefined,
    username: url.username || undefined,
    maxRetriesPerRequest: null
  };
}

export const QUEUE_NAME = "echo-scheduler";

let queue: Queue | null = null;

/** Lazily-created singleton Queue (mirrors src/db/index.js's lazy getDb() pattern). */
export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, { connection: createConnection() });
  }
  return queue;
}
