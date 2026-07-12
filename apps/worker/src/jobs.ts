/**
 * jobs.ts — translates scheduler.js's `JOBS` registry (daily "HH:MM" / interval "every N min")
 * into BullMQ repeatable-job registrations.
 *
 * Domain logic is NOT re-implemented here — only the cron/interval *trigger* shape is derived
 * from each job's existing `schedule` object (imported straight from scheduler.js, not copied).
 * The actual gating ("did this already run today?", "are we in a trading window?") still lives
 * in scheduler.js's `isDue()`/`inTradingWindow()` and is re-checked inside processor.ts before
 * the job body ever runs — BullMQ only decides *when to attempt*.
 */
import type { Queue, RepeatOptions } from "bullmq";
import { JOBS } from "../../../src/server/services/scheduler.js";

const TZ = "Asia/Shanghai";

/** "HH:MM" -> 5-field cron "MM HH * * *" (BullMQ cron, evaluated in the given tz). */
function dailyCron(at: string): string {
  const [hh, mm] = at.split(":");
  return `${Number(mm)} ${Number(hh)} * * *`;
}

interface JobSchedule {
  kind: "daily" | "interval";
  at?: string;
  everyMinutes?: number;
  tradingHoursOnly?: boolean;
}

interface JobDef {
  id: string;
  label: string;
  schedule: JobSchedule;
  run: () => Promise<string> | string;
}

/** Derive BullMQ `repeat` options for one JOBS entry. */
export function repeatOptionsFor(schedule: JobSchedule): RepeatOptions {
  if (schedule.kind === "daily") {
    return { pattern: dailyCron(schedule.at as string), tz: TZ };
  }
  // interval: fire unconditionally every N minutes; the trading-hours gate is enforced
  // inside isDue()/inTradingWindow() at run time (processor.ts), identical to how the old
  // 60s tick loop polled constantly and no-op'd outside trading hours.
  return { every: (schedule.everyMinutes as number) * 60_000 };
}

/**
 * Register one BullMQ repeatable job per entry in JOBS. Safe to call on every worker boot:
 * BullMQ computes a stable repeat "key" from (name, repeat options, jobId), so re-adding the
 * same repeatable definition on restart is a no-op, not a duplicate.
 */
export async function registerRepeatableJobs(queue: Queue): Promise<void> {
  for (const job of JOBS as JobDef[]) {
    await queue.add(
      job.id,
      { jobId: job.id },
      {
        repeat: repeatOptionsFor(job.schedule),
        jobId: job.id
      }
    );
  }
}
