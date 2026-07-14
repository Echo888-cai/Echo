/**
 * Minimal in-memory circuit breaker for live external adapters (docs/PLAN.md
 * P1 "超时熔断"). Free-tier quote providers fail in bursts — a blown daily
 * quota or a transient outage means every call for the next N minutes will
 * fail too, so retrying each one anyway just adds latency to every request
 * until the router falls through to the next adapter. Trips after
 * consecutive failures and cools down on a timer; a single success clears it
 * immediately. Process-local by design — this is a request-shedding
 * optimization, not a durability guarantee, so it doesn't need to survive a
 * restart or be shared across instances.
 */
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

interface BreakerState {
  consecutiveFailures: number;
  openUntil: number;
}

const state = new Map<string, BreakerState>();

export function isBreakerOpen(id: string): boolean {
  const entry = state.get(id);
  if (!entry) return false;
  if (entry.openUntil && Date.now() < entry.openUntil) return true;
  if (entry.openUntil && Date.now() >= entry.openUntil) state.delete(id);
  return false;
}

export function recordSuccess(id: string): void {
  state.delete(id);
}

export function recordFailure(id: string): void {
  const entry = state.get(id) || { consecutiveFailures: 0, openUntil: 0 };
  entry.consecutiveFailures += 1;
  if (entry.consecutiveFailures >= FAILURE_THRESHOLD) entry.openUntil = Date.now() + COOLDOWN_MS;
  state.set(id, entry);
}

/** Test-only: clears all breaker state between test cases. */
export function resetBreakers(): void {
  state.clear();
}
