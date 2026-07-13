/**
 * Authorization metadata — the piece REFACTOR_PROPOSAL.md §4.5 calls out as the
 * whole point of formalizing an adapter matrix: "路由器按'授权允许 → 数据质量 →
 * 延迟'三级排序选源，未授权源在商用环境自动不可选". Today every adapter in this
 * repo is `unlicensed_free_tier` (public/free APIs, no commercial agreement) —
 * that fact is now a typed, machine-checkable property instead of tribal
 * knowledge. When a commercial vendor is contracted (see docs/REFACTOR_PROPOSAL.md
 * §6 D6 — a decision this package deliberately does not make), it's registered
 * as a new adapter with `licenseTier: "licensed_commercial"`; the router then
 * prefers it automatically in commercial mode, no code path changes required.
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
