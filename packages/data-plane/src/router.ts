/**
 * The router: "授权允许 → 数据质量 → 延迟" three-tier selection
 * (docs/PLAN.md §2 数据平面). Generic over any port shape so Fundamentals/
 * News/Filings/Calendar can reuse it once they have real adapters — the
 * selection logic doesn't care what fetchQuote/fetchFundamentals/etc. does,
 * only about the authorization + qualityRank fields every port shares.
 */
import { isUsableInMode, type AdapterAuthorization } from "./authorization.js";
import type { Market } from "./market.js";

interface RoutableAdapter {
  id: string;
  authorization: AdapterAuthorization;
  supports(market: Market): boolean;
  qualityRank: number;
}

export interface SelectionResult<T extends RoutableAdapter> {
  adapter: T;
  /** Every adapter that supported the market but was excluded, and why —
   *  surfaced so callers/logs can explain "why this source" not just "which". */
  excluded: { id: string; reason: string }[];
}

export interface SelectOptions {
  /** True in production/paid-tier serving — excludes any adapter whose
   *  authorization.commercialUseAllowed is false. False (default) for local
   *  dev/research use, where free-tier adapters are fine. */
  commercialMode?: boolean;
}

/**
 * Picks the best adapter for `market` from `candidates`. Returns null (not a
 * silent fallback to an unauthorized source) when commercialMode excludes
 * every candidate — that's the compliance guarantee this whole package
 * exists for: an unauthorized source must never be reachable in commercial
 * mode, not even as a last resort.
 */
export function selectAdapter<T extends RoutableAdapter>(candidates: T[], market: Market, opts: SelectOptions = {}): SelectionResult<T> | null {
  const commercialMode = opts.commercialMode ?? false;
  const excluded: { id: string; reason: string }[] = [];
  const eligible = candidates.filter((c) => {
    if (!c.supports(market)) {
      excluded.push({ id: c.id, reason: `no coverage for market ${market}` });
      return false;
    }
    if (!isUsableInMode(c.authorization, commercialMode)) {
      excluded.push({ id: c.id, reason: `licenseTier=${c.authorization.licenseTier} not usable in commercial mode` });
      return false;
    }
    return true;
  });
  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    if (a.qualityRank !== b.qualityRank) return a.qualityRank - b.qualityRank;
    const aLat = a.authorization.slaLatencyMsP95 ?? Infinity;
    const bLat = b.authorization.slaLatencyMsP95 ?? Infinity;
    return aLat - bLat;
  });

  const [adapter, ...rest] = eligible;
  for (const r of rest) excluded.push({ id: r.id, reason: "lower-ranked than selected adapter" });
  return { adapter, excluded };
}

/**
 * Same authorization + quality-rank filtering as selectAdapter, but returns
 * the whole eligible chain in rank order instead of just the top pick — used
 * where a caller needs to fail over to the next adapter when the top choice
 * errors out or returns no data, rather than surfacing that as a hard failure.
 */
export function selectAdapterChain<T extends RoutableAdapter>(candidates: T[], market: Market, opts: SelectOptions = {}): T[] {
  const commercialMode = opts.commercialMode ?? false;
  return candidates
    .filter((c) => c.supports(market) && isUsableInMode(c.authorization, commercialMode))
    .sort((a, b) => {
      if (a.qualityRank !== b.qualityRank) return a.qualityRank - b.qualityRank;
      const aLat = a.authorization.slaLatencyMsP95 ?? Infinity;
      const bLat = b.authorization.slaLatencyMsP95 ?? Infinity;
      return aLat - bLat;
    });
}
