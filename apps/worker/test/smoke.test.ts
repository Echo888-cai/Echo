/**
 * smoke.test.ts — R-2 worker smoke test.
 *
 * Follows tests/setupTestDb.mjs's isolation pattern: point ECHO_DB_PATH at a throwaway
 * temp file BEFORE importing scheduler.js (which reads the env var lazily on first
 * getDb() call), so this never touches the dev echo.db / scheduler_state table.
 *
 * Does NOT let any real job body run against live services: a synthetic job entry with a
 * spied `run()` is pushed onto the (module-cached) JOBS array instead of exercising one of
 * the 8 real jobs, so there's no dependency on notifier/market-data/etc being reachable.
 *
 * Verifies:
 *  [1] isDue() misfire catch-up: a daily job scheduled for earlier today, never run, is due
 *      immediately (no need to wait for the exact clock minute) — same semantic tickOnce()
 *      relies on for "restart after downtime still catches up on today's run".
 *  [2] processJob() gating: calling the processor twice back-to-back for a job that already
 *      ran today does NOT invoke the underlying run() a second time.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.ECHO_DB_PATH) {
  process.env.ECHO_DB_PATH = join(tmpdir(), `echo-worker-test-${process.pid}.db`);
}

import test from "node:test";
import assert from "node:assert/strict";
import type { Job } from "bullmq";
import { JOBS, isDue } from "../../../src/server/services/scheduler.js";
import { processJob } from "../src/processor.js";

test("isDue: daily job scheduled earlier today fires promptly (misfire catch-up)", () => {
  const schedule = { kind: "daily", at: "00:00" };
  const now = new Date();
  assert.equal(isDue(schedule, null, now), true, "never-run job past its daily time should be due");
});

test("isDue: daily job already run after today's scheduled time is NOT due again", () => {
  const schedule = { kind: "daily", at: "00:00" };
  const now = new Date();
  assert.equal(isDue(schedule, now.toISOString(), now), false, "just-ran job should not be due again same day");
});

test("processJob: back-to-back calls for an already-run-today job do not double-invoke run()", async () => {
  let calls = 0;
  const testJob = {
    id: "test_smoke_job",
    label: "smoke test job",
    schedule: { kind: "daily", at: "00:00" },
    run: async () => {
      calls += 1;
      return "smoke test ran";
    }
  };
  (JOBS as any[]).push(testJob);
  try {
    const fakeJob = { name: testJob.id } as Job;

    const first = await processJob(fakeJob);
    assert.equal(calls, 1, "first attempt should run the job body once");
    assert.match(first, /smoke test ran/);

    const second = await processJob(fakeJob);
    assert.equal(calls, 1, "second back-to-back attempt should NOT re-run the job body");
    assert.match(second, /skipped: not due/);
  } finally {
    const idx = (JOBS as any[]).indexOf(testJob);
    if (idx >= 0) (JOBS as any[]).splice(idx, 1);
  }
});

test("processJob: unknown job id throws instead of silently no-op'ing", async () => {
  const fakeJob = { name: "does_not_exist" } as Job;
  await assert.rejects(() => processJob(fakeJob), /unknown job id/);
});
