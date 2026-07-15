/**
 * Manual verification against real tickers (same spirit as scripts/canary.js
 * at the repo root, scoped to this package): proves the router + quality
 * guard behave correctly against live data for all four wired ports, and
 * proves commercial-mode exclusion actually excludes rather than silently
 * falling through. Not wired into `npm test` / CI — run with
 * `npm run verify -w @echo/data-plane`.
 */
import { getQuote, getFundamentals, getFilings, getNextEarnings, NoAuthorizedAdapterError } from "./registry.js";

const TICKERS = ["0700.HK", "AAPL"];

async function verifyPort<T>(label: string, fn: (ticker: string, opts?: { commercialMode?: boolean }) => Promise<{ result: T; adapterId: string; quality: { score: number; issues: unknown[] } }>) {
  console.log(`\n== ${label}: research mode ==`);
  for (const ticker of TICKERS) {
    try {
      const { adapterId, quality } = await fn(ticker);
      console.log(`${ticker}: adapter=${adapterId} quality=${quality.score}${quality.issues.length ? ` issues=${JSON.stringify(quality.issues)}` : ""}`);
    } catch (err) {
      console.log(`${ticker}: FAILED — ${(err as Error).message}`);
    }
  }
  console.log(`== ${label}: commercial mode (should reject all — no licensed adapter registered) ==`);
  for (const ticker of TICKERS) {
    try {
      const { adapterId } = await fn(ticker, { commercialMode: true });
      console.log(`${ticker}: UNEXPECTED — adapter=${adapterId} was selected in commercial mode`);
    } catch (err) {
      if (err instanceof NoAuthorizedAdapterError) console.log(`${ticker}: correctly rejected`);
      else console.log(`${ticker}: FAILED for the wrong reason — ${(err as Error).message}`);
    }
  }
}

async function main() {
  await verifyPort("quote", getQuote);
  await verifyPort("fundamentals", getFundamentals);
  await verifyPort("filings", getFilings);
  await verifyPort("calendar (next earnings)", getNextEarnings);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
