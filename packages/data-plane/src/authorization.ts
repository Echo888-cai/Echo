/**
 * Authorization metadata — the router sorts sources by 授权允许 → 数据质量 →
 * 延迟, and unauthorized sources are automatically unselectable in commercial
 * mode (docs/PLAN.md 红线 5). Today every third-party adapter in this repo is
 * `unlicensed_free_tier` (public/free APIs, no commercial agreement) — that
 * fact is a typed, machine-checkable property instead of tribal knowledge.
 * When a commercial vendor is contracted (procurement list in docs/PLAN.md
 * 第 6 节), it's registered as a new adapter with
 * `licenseTier: "licensed_commercial"`; the router then prefers it
 * automatically in commercial mode, no code path changes required.
 */

export type LicenseTier =
  /** Public/free API, no commercial-use agreement. Research/dev only. */
  | "unlicensed_free_tier"
  /** Own first-party pipeline (e.g. CNINFO/HKEX/EDGAR filing ingestion) — not a
   *  third-party license question, always allowed. */
  | "first_party"
  /** Paid vendor with a commercial-use agreement in place. */
  | "licensed_commercial";

export interface AdapterAuthorization {
  licenseTier: LicenseTier;
  /** Explicit, not derived from licenseTier by convention alone — a licensed
   *  vendor contract can still carry a "no redistribution" or research-only
   *  clause, so this is the one field the router actually reads. */
  commercialUseAllowed: boolean;
  /** Requests/day this adapter's current key(s)/plan allow, if known. */
  quotaPerDay?: number;
  /** Declared cost per successful call in USD (0 for free tiers). */
  costPerCallUsd?: number;
  /** Vendor-declared or observed p95 latency, ms — used as the router's final
   *  tiebreaker among authorized, equal-quality adapters. */
  slaLatencyMsP95?: number;
  /** Free-text: contract reference, quota reset cadence, coverage caveats. */
  notes?: string;
}

export function isUsableInMode(auth: AdapterAuthorization, commercialMode: boolean): boolean {
  return commercialMode ? auth.commercialUseAllowed : true;
}
