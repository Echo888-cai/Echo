/**
 * main.ts — Echo Research scheduler worker entrypoint (R-2).
 *
 * Parallel path, NOT wired into server.js: this process runs the 8 background jobs
 * (previously driven by the in-process setInterval tick loop in scheduler.js) via a
 * BullMQ Worker backed by Redis instead. Domain logic (runDigestJob, runPositionLinesJob,
 * etc.) is untouched — only the trigger mechanism moved.
 *
 * Cutover to replace the in-process scheduler is a separate, later decision.
 */
import { Worker } from "bullmq";
import { createConnection, getQueue, QUEUE_NAME } from "./queue.js";
import { registerRepeatableJobs } from "./jobs.js";
import { processJob } from "./processor.js";

async function main() {
  const queue = getQueue();
  await registerRepeatableJobs(queue);
  console.log(`[worker] repeatable jobs registered on queue "${QUEUE_NAME}"`);

  const worker = new Worker(QUEUE_NAME, processJob, {
    connection: createConnection(),
    concurrency: 1 // scheduler.js's jobs were always run serially (for...await in tickOnce)
  });

  worker.on("completed", (job) => {
    console.log(`[worker] job ${job.name} completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.name} failed:`, err?.message || err);
  });

  const shutdown = async (signal: string) => {
    console.log(`[worker] received ${signal}, shutting down...`);
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  console.log("[worker] Echo Research scheduler worker started");
}

main().catch((err) => {
  console.error("[worker] fatal startup error:", err);
  process.exit(1);
});
