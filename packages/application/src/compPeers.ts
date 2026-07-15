/**
 * Comparable peers use case: supplier peers+multiples (data-plane) → stage
 * bucketing and anchor percentiles (domain) → cached in comp_peers (db).
 *
 * This is what finally gives that table a writer. `upsertCompPeers` has existed
 * since the schema landed but had **no caller anywhere in the repo** — the rows
 * sitting in comp_peers were written by an uncommitted script and frozen since
 * 2026-07-10, the same frozen-dirty-data shape already found in
 * earnings_calendar (docs/PLAN.md P1). A cache nobody writes is not a cache,
 * it's a fossil, so it is only read here behind a TTL that our own writes keep
 * refreshing.
 *
 * Downstream this feeds three things that were all built and tested but never
 * fed real peers: valuation.js's PE / EV-Sales peer anchors, answerComposer's
 * 同业对照 prompt block, and factGuard's multiple registry.
 */
import { getCompPeers as fetchProviderPeers } from "@echo/data-plane";
import { buildCompPeers } from "@echo/domain";
import { getCompPeersRow, upsertCompPeers } from "@echo/db/repositories/compPeersRepository.js";

const TTL_MS = 24 * 60 * 60 * 1000;

function safeParse(json: string | null, fallback: unknown) {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

function rowToResult(row: any, { stale = false } = {}) {
  return {
    ticker: row.ticker,
    stage: row.stage,
    peers: safeParse(row.peers_json, []),
    anchor: safeParse(row.anchor_json, null),
    providerStatus: row.provider_status,
    // A stale-but-served row must say so: the composer prints this detail
    // verbatim and factGuard registers its multiples as citable facts.
    detail: stale && row.detail ? `${row.detail}（缓存数据，本轮供应商不可用）` : row.detail,
    partial: Boolean(row.partial),
    fetchedAt: row.fetched_at
  };
}

/**
 * Peers for one subject. Never throws: peers are an enrichment, and a supplier
 * outage must degrade the answer's comparables section, not fail the research
 * call. Falls back to a stale cache row when the live call fails, and to an
 * honest "missing" when there is nothing at all.
 *
 * @param financialsData the subject's own filing-grade financials — the domain
 *        classifies the subject's stage from these, never from a provider's PE.
 */
export async function getComparablePeers(ticker: string, financialsData: any) {
  let cached: any = null;
  try {
    cached = await getCompPeersRow(ticker);
    if (cached?.fetched_at && Date.now() - new Date(cached.fetched_at).getTime() < TTL_MS) {
      return rowToResult(cached);
    }
  } catch { /* cache unavailable — fall through to the live call */ }

  try {
    const { result } = await fetchProviderPeers(ticker);
    const peerQuotes = Array.isArray((result as any).peers) ? (result as any).peers : [];
    if ((result as any).providerStatus !== "ok") {
      const miss = { ticker, stage: null, peers: [], anchor: null, providerStatus: "missing" as const,
        detail: String((result as any).detail || "供应商未返回同业"), partial: false };
      await upsertCompPeers({ ticker, providerStatus: "missing", detail: miss.detail, peers: [], anchor: null }).catch(() => {});
      return miss;
    }
    const composed = buildCompPeers(financialsData, peerQuotes) as any;
    await upsertCompPeers({
      ticker, stage: composed.stage, peers: composed.peers, anchor: composed.anchor,
      providerStatus: composed.providerStatus, detail: composed.detail, partial: Boolean((result as any).partial)
    }).catch(() => {});
    return { ticker, ...composed, partial: Boolean((result as any).partial) };
  } catch (error) {
    // "No adapter serves this market" is structural, not a transient outage:
    // A-shares have no ADR route and no Finnhub coverage, so there will never be
    // a fresher row and stale-if-error would serve a fossil forever. Real case
    // caught here: 600519.SS kept returning a 2026-07-10 row written by the
    // uncommitted script — which even mislabelled the A-share as 港股 — long
    // after this pipeline could tell the truth. Answer honestly and overwrite it.
    if ((error as any)?.name === "NoAuthorizedAdapterError") {
      const detail = "本市场没有可用的同业数据源（A 股无美股 ADR 映射，Finnhub 免费档无 CN 覆盖）";
      await upsertCompPeers({ ticker, providerStatus: "missing", detail, peers: [], anchor: null }).catch(() => {});
      return { ticker, stage: null, peers: [], anchor: null, providerStatus: "missing" as const, detail, partial: false };
    }
    if (cached) return rowToResult(cached, { stale: true });
    return { ticker, stage: null, peers: [], anchor: null, providerStatus: "missing" as const,
      detail: error instanceof Error ? error.message : "同业源不可用", partial: false };
  }
}
