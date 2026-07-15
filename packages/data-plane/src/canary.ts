/**
 * Real-probe canary for every live quote adapter (docs/PLAN.md P1 "canary 真
 * 探测"): calls each registered adapter against a real ticker and writes an
 * honest ok/error row to canary_runs, so the settings page can show "配置了
 * 但探测失败" instead of the old decorative "已配置" env-key check
 * (apps/api/src/status.ts previously only checked `Boolean(process.env.X_API_KEY)`,
 * never made a real call). Not wired into `npm test`/CI — this makes real
 * network calls against paid-quota-limited free tiers (Alpha Vantage: 25/day),
 * so it runs on a schedule or on demand via `npm run canary`, same as
 * verify.ts's "manual, real tickers" spirit but persisted instead of printed.
 */
import { randomUUID } from "node:crypto";
import { loadRootEnv } from "@echo/observability";
import { insertCanaryResult } from "@echo/db/repositories/canaryRepository.js";
import { closeDatabase } from "@echo/db/repositories/context.js";
import { detectMarket } from "./market.js";

// registry.js reads process.env.*_API_KEY at module-evaluation time to decide
// which live quote adapters to register (apps/api/src/server.ts uses the same
// pattern for the same reason: static imports are hoisted and evaluated
// before any top-level code in *this* file runs, so loadRootEnv() must
// execute — and .env must already be loaded — before registry.js is ever
// imported, not just before its exports are called).
loadRootEnv();
const { listLiveQuoteAdapters, listExternalFundamentalsAdapters, listExternalCalendarAdapters, listExternalCompPeersAdapters } = await import("./registry.js");

// One representative ticker per market an adapter might plausibly serve —
// each adapter's own supports() decides whether it's actually probed with it.
const PROBE_TICKERS = ["AAPL", "0700.HK", "600519.SS"];

interface ProbeOutcome {
  status: "ok" | "missing";
  detail: string;
}

/** A capability group: which adapters to probe, and how to call one. The
 *  `capability` prefix is what apps/api/src/status.ts groups probe rows by
 *  (`market:*`, `financials:*`, `earnings:*`) to derive each source card. */
interface ProbeGroup<T extends { id: string; supports(market: ReturnType<typeof detectMarket>): boolean }> {
  capability: string;
  adapters: T[];
  probe(adapter: T, ticker: string): Promise<ProbeOutcome>;
}

async function runGroup<T extends { id: string; supports(market: ReturnType<typeof detectMarket>): boolean }>(
  group: ProbeGroup<T>, batchId: string
) {
  for (const adapter of group.adapters) {
    const source = `${group.capability}:${adapter.id}`;
    for (const ticker of PROBE_TICKERS) {
      if (!adapter.supports(detectMarket(ticker))) continue;
      const startedAt = Date.now();
      try {
        const { status, detail } = await group.probe(adapter, ticker);
        const latencyMs = Date.now() - startedAt;
        await insertCanaryResult({ batchId, source, ticker, status, latencyMs, detail });
        console.log(`[canary] ${source} ${ticker} -> ${status} (${latencyMs}ms)`);
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        const detail = err instanceof Error ? err.message : String(err);
        await insertCanaryResult({ batchId, source, ticker, status: "error", latencyMs, detail });
        console.log(`[canary] ${source} ${ticker} -> error (${latencyMs}ms): ${detail}`);
      }
    }
  }
}

async function main() {
  const batchId = randomUUID();
  const groups = [
    {
      capability: "market",
      adapters: listLiveQuoteAdapters(),
      async probe(adapter, ticker) {
        const result = await adapter.fetchQuote(ticker);
        return result.providerStatus === "ok"
          ? { status: "ok" as const, detail: `price=${result.price} currency=${result.currency}` }
          : { status: "missing" as const, detail: result.errors?.join("; ") || "adapter returned no data" };
      }
    } satisfies ProbeGroup<ReturnType<typeof listLiveQuoteAdapters>[number]>,
    {
      capability: "financials",
      adapters: listExternalFundamentalsAdapters(),
      async probe(adapter, ticker) {
        const result = await adapter.fetchFundamentals(ticker);
        const rows = Array.isArray(result.rows) ? result.rows.length : 0;
        return result.providerStatus === "ok"
          ? { status: "ok" as const, detail: `${rows} period(s), source=${result.source ?? adapter.id}` }
          : { status: "missing" as const, detail: "adapter returned no fundamentals" };
      }
    } satisfies ProbeGroup<ReturnType<typeof listExternalFundamentalsAdapters>[number]>,
    {
      capability: "earnings",
      adapters: listExternalCalendarAdapters(),
      async probe(adapter, ticker) {
        const result = await adapter.fetchNextEarnings(ticker);
        return result.providerStatus === "ok"
          ? { status: "ok" as const, detail: `nextDate=${String(result.nextDate)} source=${result.source ?? adapter.id}` }
          : { status: "missing" as const, detail: "adapter returned no calendar entry" };
      }
    } satisfies ProbeGroup<ReturnType<typeof listExternalCalendarAdapters>[number]>,
    {
      capability: "comp_peers",
      adapters: listExternalCompPeersAdapters(),
      async probe(adapter, ticker) {
        const result = await adapter.fetchPeers(ticker);
        const peers = Array.isArray(result.peers) ? result.peers : [];
        return result.providerStatus === "ok"
          ? { status: "ok" as const, detail: `${peers.length} 家同业，source=${result.source ?? adapter.id}` }
          : { status: "missing" as const, detail: String(result.detail ?? "adapter returned no peers") };
      }
    } satisfies ProbeGroup<ReturnType<typeof listExternalCompPeersAdapters>[number]>
  ];
  const total = groups.reduce((sum, group) => sum + group.adapters.length, 0);
  if (!total) {
    console.log("[canary] no external adapters registered (no API keys configured) — nothing to probe");
    return;
  }
  console.log(`[canary] batch ${batchId}: probing ${groups.flatMap((g) => g.adapters.map((a) => `${g.capability}:${a.id}`)).join(", ")}`);
  for (const group of groups) await runGroup(group as ProbeGroup<any>, batchId);
  console.log(`[canary] batch ${batchId} complete`);
}

// The postgres pool keeps the event loop alive, so without closing it the
// script prints "complete" and then hangs forever instead of exiting — fine
// when a human ctrl-Cs it, fatal for the scheduled/CI runs this canary exists
// to feed (they'd block until killed and report a timeout, not a probe result).
main()
  .catch((err) => {
    console.error("[canary] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
