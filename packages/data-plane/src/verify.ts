/**
 * Manual verification against real tickers (same spirit as scripts/canary.js
 * at the repo root, scoped to this package): proves the router + quality
 * guard behave correctly against live data, and proves commercial-mode
 * exclusion actually excludes rather than silently falling through. Not
 * wired into `npm test` / CI — run with `npm run verify -w @echo/data-plane`.
 */
import { getQuote, NoAuthorizedAdapterError } from "./registry.js";

const TICKERS = ["0700.HK", "AAPL", "600519.SS"];

async function main() {
  console.log("== research mode (free-tier adapters usable) ==");
  for (const ticker of TICKERS) {
    try {
      const { result, adapterId, quality } = await getQuote(ticker);
      console.log(
        `${ticker}: adapter=${adapterId} price=${result.price} ${result.currency ?? ""} providerStatus=${result.providerStatus} ` +
          `quality=${quality.score}${quality.issues.length ? ` issues=${JSON.stringify(quality.issues)}` : ""}`
      );
    } catch (err) {
      console.log(`${ticker}: FAILED — ${(err as Error).message}`);
    }
  }

  console.log("\n== commercial mode (only licensed_commercial/first_party adapters usable) ==");
  for (const ticker of TICKERS) {
    try {
      const { adapterId } = await getQuote(ticker, { commercialMode: true });
      console.log(`${ticker}: UNEXPECTED — adapter=${adapterId} was selected in commercial mode`);
    } catch (err) {
      if (err instanceof NoAuthorizedAdapterError) {
        console.log(`${ticker}: correctly rejected — ${err.message}`);
      } else {
        console.log(`${ticker}: FAILED for the wrong reason — ${(err as Error).message}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
