import type { Market } from "../market.js";
import type { CompPeersPort, PeerQuote } from "../ports.js";
import { adrOrBareSymbol, adrForHk } from "../hkAdr.js";
import { hkCode, isUS } from "../market.js";

/**
 * Comparable-company discovery + per-peer multiples via Finnhub's free tier.
 *
 * Verified live on 2026-07-15 against the real key:
 *   - `/stock/peers?symbol=AAPL` → 12 same-industry US symbols (free).
 *   - `/stock/peers?symbol=0700.HK` → 403 "You don't have access to this
 *     resource" — the same free-tier boundary already proven for quotes,
 *     fundamentals and the earnings calendar. HK is therefore served the same
 *     way the calendar solves it: query the company's US ADR (hkAdr.ts's
 *     hand-verified table). A-shares have no ADR pipeline and no Finnhub
 *     coverage, so they honestly resolve to missing rather than guessing.
 *   - `/stock/metric?symbol=X&metric=all` → real `peTTM`, `evRevenueTTM`,
 *     `epsTTM`, `netProfitMarginTTM`, `revenueGrowthTTMYoy` per symbol.
 *
 * This adapter returns provider facts only. Which multiple is comparable to
 * which (PE vs EV/Sales, by asset stage) and the anchor percentiles are domain
 * rules — see packages/domain/src/compPeerRules.js.
 */

const MAX_PEERS = 5; // 1 peers call + MAX_PEERS metric calls per subject; free tier is 60/min.
const TIMEOUT_MS = 6000;

function numOrNull(value: unknown): number | null {
  // Number(null) === 0: a missing field must never become a real zero multiple.
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function finnhub(path: string): Promise<any> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("missing FINNHUB_API_KEY");
  const sep = path.includes("?") ? "&" : "?";
  const response = await fetch(`https://finnhub.io/api/v1${path}${sep}token=${key}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "EchoResearch/1.0 comp peers" }
  });
  if (!response.ok) throw new Error(`finnhub ${path.split("?")[0]} ${response.status}`);
  return response.json();
}

/**
 * Finnhub's peer list → symbols our own pipeline can actually price, with the
 * subject itself removed. Querying an ADR returns the company's own HK line in
 * the list too (e.g. TCEHY's peers include 700.HK), which would otherwise make
 * a company its own comparable.
 */
async function peerSymbolsFor(ticker: string): Promise<{ symbols: string[]; detail: string | null }> {
  const symbol = adrOrBareSymbol(ticker);
  if (!symbol) {
    return { symbols: [], detail: "港股无美股 ADR 映射，Finnhub 免费档无法核到同业" };
  }
  const data = await finnhub(`/stock/peers?symbol=${encodeURIComponent(symbol)}`);
  if (!Array.isArray(data)) throw new Error("finnhub peers 返回格式异常");
  const selfHk = isUS(ticker) ? null : hkCode(ticker);
  const selfAdr = (adrForHk(ticker) || "").toUpperCase();
  const selfBare = String(ticker || "").trim().toUpperCase();
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const raw of data) {
    const s = String(raw || "").trim().toUpperCase();
    if (!s || s === symbol.toUpperCase() || s === selfAdr) continue;
    let normalized: string;
    if (/^\d{1,5}\.HK$/.test(s)) {
      if (hkCode(s) === selfHk) continue; // the subject's own HK line, via its ADR's peer list
      normalized = `${hkCode(s)}.HK`;
    } else if (/^[A-Z.]{1,6}$/.test(s)) {
      if (s === selfBare) continue;
      normalized = s;
    } else {
      continue; // A-shares and other venues this pipeline cannot price
    }
    if (seen.has(normalized)) continue;
    // Only keep peers we can actually resolve to a Finnhub-servable symbol, and
    // check that *before* spending one of the MAX_PEERS slots. Real case: TCEHY's
    // peer list is ["700.HK","1024.HK","300418.SZ","BIDU","1357.HK","9898.HK",…,
    // "BILI",…] — capping first burned all 5 slots on HK names with no ADR
    // (dropped later when their metric call couldn't resolve), leaving exactly
    // one usable peer and never reaching BILI, which we can price.
    if (!adrOrBareSymbol(normalized)) continue;
    seen.add(normalized);
    symbols.push(normalized);
    if (symbols.length >= MAX_PEERS) break;
  }
  return { symbols, detail: symbols.length ? null : "Finnhub 同业清单里没有本管道能定价的标的（多为 A 股/其它交易所）" };
}

/** One peer's raw multiples. HK peers are queried through their own ADR; a peer
 *  we can't resolve is dropped rather than reported with a null multiple. */
async function peerQuote(peerTicker: string): Promise<PeerQuote | null> {
  const symbol = adrOrBareSymbol(peerTicker);
  if (!symbol) return null;
  try {
    const body = await finnhub(`/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`);
    const m = body?.metric || {};
    return {
      ticker: peerTicker,
      epsTtm: numOrNull(m.epsTTM),
      netMargin: numOrNull(m.netProfitMarginTTM),
      revenueGrowth: numOrNull(m.revenueGrowthTTMYoy),
      pe: numOrNull(m.peTTM),
      evRevenue: numOrNull(m.evRevenueTTM)
    };
  } catch {
    return null; // one slow/failed peer must not fail the whole set
  }
}

export const finnhubPeersAdapter: CompPeersPort = {
  id: "finnhub",
  authorization: {
    licenseTier: "unlicensed_free_tier",
    commercialUseAllowed: false,
    quotaPerDay: 86_400,
    costPerCallUsd: 0,
    slaLatencyMsP95: 2500,
    notes: "Finnhub free tier: /stock/peers + /stock/metric. US direct; HK only via the hand-verified ADR table."
  },
  qualityRank: 1,
  // HK is declared supported because the ADR route genuinely serves the mapped
  // names; unmapped HK tickers resolve to "missing" inside fetchPeers, and the
  // registry chain falls through to the postgres cache — same shape as
  // hkAdrCalendarAdapter.
  supports(market: Market) { return market === "US" || market === "HK"; },
  async fetchPeers(ticker: string) {
    const { symbols, detail } = await peerSymbolsFor(ticker);
    if (!symbols.length) return { providerStatus: "missing" as const, source: "finnhub", peers: [], detail };
    const settled = await Promise.all(symbols.map((s) => peerQuote(s)));
    const peers = settled.filter((p): p is PeerQuote => p !== null);
    if (!peers.length) return { providerStatus: "missing" as const, source: "finnhub", peers: [], detail: "同业倍数全部拉取失败" };
    const via = isUS(ticker) ? "finnhub" : `finnhub-via-adr:${adrForHk(ticker)}`;
    return { providerStatus: "ok" as const, source: via, peers, partial: peers.length < symbols.length };
  }
};
