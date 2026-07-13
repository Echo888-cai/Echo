/**
 * Contracts for src/server/routes/watch.js.
 *
 *   GET  /api/watch/desk?slot=&tickers=&events= → {desk}
 *   GET  /api/watch/stock?ticker=                → {stock}
 *   POST /api/watch/track   {ticker, name?}       → {tracked, ticker}
 *   POST /api/watch/untrack {ticker}              → {untracked, ticker}
 *
 * services/watchDesk.js builds `desk`/`stock` from live market data + portraits;
 * shapes below are best-effort (loose) rather than field-exact, per R-0 scope.
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

export const watchDeskSchema = z.object({
  generatedAt: z.string(),
  slot: z.enum(["premarket", "afterhours"]),
  cards: z.array(z.record(z.string(), z.unknown())),
  counts: z.object({
    falsified: z.number(),
    atRisk: z.number(),
    intact: z.number(),
    total: z.number()
  }),
  failures: z.array(z.unknown()),
  partial: z.boolean().optional()
});
export const watchDeskResponseSchema = okEnvelope(z.object({ desk: watchDeskSchema }));

export const watchStockResponseSchema = okEnvelope(
  z.object({ stock: z.record(z.string(), z.unknown()) })
);

export const watchTrackRequestSchema = z.object({ ticker: z.string(), name: z.string().optional() });
export const watchTrackResponseSchema = okEnvelope(
  z.object({ tracked: z.literal(true), ticker: z.string() })
);

export const watchUntrackRequestSchema = z.object({ ticker: z.string() });
export const watchUntrackResponseSchema = okEnvelope(
  z.object({ untracked: z.literal(true), ticker: z.string() })
);
