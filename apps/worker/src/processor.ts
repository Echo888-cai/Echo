/**
 * processor.ts — BullMQ Worker processor function.
 *
 * BullMQ decides *when to attempt* a job (via the repeatable schedule in jobs.ts). This
 * function decides *whether to actually run it*, reusing scheduler.js's own `isDue()` +
 * `getState`/`setState` against the existing `scheduler_state` SQLite table — the same
 * "misfire catch-up, don't replay history" and "trading-hours-only" gating the old
 * setInterval tick loop applied in `tickOnce()`. The only change to scheduler.js was
 * exporting `getState`/`setState` (previously module-private) so they can be reused here
 * without duplicating the SQL.
 */
import type { Job } from "bullmq";
import { JOBS, isDue, getState, setState } from "../../../src/server/services/scheduler.js";

interface JobDef {
  id: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- schedule shape is a plain
  // object documented in scheduler.js's isDue() JSDoc; isDue itself is untyped JS.
  schedule: any;
  run: () => Promise<string> | string;
}

/** Processes one BullMQ job attempt: id -> lookup JOBS def -> isDue gate -> run() -> record state. */
export async function processJob(job: Job): Promise<string> {
  const def = (JOBS as JobDef[]).find((j) => j.id === job.name);
  if (!def) {
    throw new Error(`[worker] unknown job id "${job.name}" — not found in scheduler.js JOBS`);
  }

  const now = new Date();
  const state = getState(def.id);
  if (!isDue(def.schedule, state?.last_run_at || null, now)) {
    return `skipped: not due (last_run_at=${state?.last_run_at || "never"})`;
  }

  const startedIso = now.toISOString();
  try {
    const detail = await def.run();
    setState(def.id, { lastRunAt: startedIso, status: "ok", detail });
    console.log(`[worker] ${def.id} ok: ${detail}`);
    return detail;
  } catch (err: any) {
    setState(def.id, { lastRunAt: startedIso, status: "error", detail: err?.message || String(err) });
    console.error(`[worker] ${def.id} failed:`, err?.message || err);
    throw err;
  }
}
