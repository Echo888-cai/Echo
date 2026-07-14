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
import { detectMarket } from "./market.js";

// registry.js reads process.env.*_API_KEY at module-evaluation time to decide
// which live quote adapters to register (apps/api/src/server.ts uses the same
// pattern for the same reason: static imports are hoisted and evaluated
// before any top-level code in *this* file runs, so loadRootEnv() must
// execute — and .env must already be loaded — before registry.js is ever
// imported, not just before its exports are called).
loadRootEnv();
const { listLiveQuoteAdapters } = await import("./registry.js");

// One representative ticker per market an adapter might plausibly serve —
// each adapter's own supports() decides whether it's actually probed with it.
const PROBE_TICKERS = ["AAPL", "0700.HK", "600519.SS"];

async function probeAdapter(adapter: ReturnType<typeof listLiveQuoteAdapters>[number], batchId: string) {
  for (const ticker of PROBE_TICKERS) {
    if (!adapter.supports(detectMarket(ticker))) continue;
    const startedAt = Date.now();
    try {
      const result = await adapter.fetchQuote(ticker);
      const latencyMs = Date.now() - startedAt;
      const status = result.providerStatus === "ok" ? "ok" : "missing";
      await insertCanaryResult({
        batchId, source: `market:${adapter.id}`, ticker, status, latencyMs,
        detail: status === "ok" ? `price=${result.price} currency=${result.currency}` : "adapter returned no data"
      });
      console.log(`[canary] market:${adapter.id} ${ticker} -> ${status} (${latencyMs}ms)`);
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const detail = err instanceof Error ? err.message : String(err);
      await insertCanaryResult({ batchId, source: `market:${adapter.id}`, ticker, status: "error", latencyMs, detail });
      console.log(`[canary] market:${adapter.id} ${ticker} -> error (${latencyMs}ms): ${detail}`);
    }
  }
}

async function main() {
  const batchId = randomUUID();
  const adapters = listLiveQuoteAdapters();
  if (!adapters.length) {
    console.log("[canary] no live quote adapters registered (no API keys configured) — nothing to probe");
    return;
  }
  console.log(`[canary] batch ${batchId}: probing ${adapters.map((a) => a.id).join(", ")}`);
  for (const adapter of adapters) await probeAdapter(adapter, batchId);
  console.log(`[canary] batch ${batchId} complete`);
}

main().catch((err) => {
  console.error("[canary] fatal:", err);
  process.exit(1);
});
