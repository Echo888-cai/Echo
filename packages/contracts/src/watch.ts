/**
 * Watch desk contracts.
 *
 *   GET  /api/watch/desk?slot=&tickers=&events= → {desk}
 *   GET  /api/watch/stock?ticker=                → {stock}
 *   POST /api/watch/track   {ticker, name?}       → {tracked, ticker}
 *   POST /api/watch/untrack {ticker}              → {untracked, ticker}
 *
 * Output shapes are field-exact: the frontend (WatchList.tsx, StockDetail.tsx)
 * reads these fields directly and any field not listed here does not exist on
 * the wire. Fields the pipeline can't populate yet are typed nullable/empty
 * rather than omitted, so "未接入" is representable without lying about shape.
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

// "unsupported" = 已停止覆盖的市场（A 股退场后的存量 .SS/.SZ 条目）：用户记录
// 不静默删除，但不再提供行情与研究，UI 以"已停止覆盖"标注。
const marketEnum = z.enum(["US", "HK", "unsupported"]);
const cardStatusEnum = z.enum(["falsified", "at_risk", "intact"]);
const priceStatusEnum = z.enum(["ok", "missing", "loading"]);

const earningsSchema = z.object({ nextDate: z.string().nullable() }).nullable();
const sparkSchema = z.object({ points: z.array(z.number()), changePct: z.number().nullable() }).nullable();
const topEventSchema = z.object({ title: z.string(), url: z.string().nullable() }).nullable();

export const watchCardSchema = z.object({
  ticker: z.string(),
  companyName: z.string(),
  market: marketEnum,
  status: cardStatusEnum,
  price: z.number().nullable(),
  currency: z.string().nullable(),
  changePct: z.number().nullable(),
  priceStatus: priceStatusEnum,
  held: z.boolean(),
  returnPct: z.number().nullable(),
  thesis: z.string(),
  confidence: z.string(),
  asOf: z.string().nullable(),
  updatedAt: z.string().nullable(),
  earnings: earningsSchema,
  spark: sparkSchema,
  topEvent: topEventSchema
});

export const watchDeskSchema = z.object({
  generatedAt: z.string(),
  slot: z.enum(["premarket", "afterhours"]),
  cards: z.array(watchCardSchema),
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

export const stockDetailFalsifierSchema = z.object({
  id: z.number().nullable(),
  label: z.string(),
  kind: z.string(),
  threshold: z.number().nullable(),
  triggered: z.boolean(),
  sane: z.boolean(),
  distancePct: z.number().nullable(),
  lastTriggeredAt: z.string().nullable().optional(),
  asOf: z.string().nullable().optional()
});

export const stockDetailEventSchema = z.object({
  title: z.string(),
  url: z.string().nullable(),
  date: z.string().nullable(),
  severity: z.enum(["high", "medium", "low"]).default("low"),
  relatedCount: z.number().optional()
});

export const stockDetailSeriesSchema = z.object({
  providerStatus: z.enum(["ok", "unavailable"]),
  points: z.array(z.object({ date: z.string(), close: z.number() }))
});

export const stockDetailFundamentalsSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  pe: z.number().nullable(),
  revenueGrowth: z.number().nullable(),
  grossMargin: z.number().nullable(),
  freeCashFlow: z.number().nullable(),
  currency: z.string().nullable()
});

export const stockDetailProfileSchema = z
  .object({
    thesis: z.string().nullable(),
    researchStatus: z.string().nullable(),
    confidence: z.string().nullable(),
    turnCount: z.number().nullable(),
    falsifiers: z.array(z.string())
  })
  .nullable();

export const earningsDashboardSchema = z
  .object({
    nextDate: z.string().nullable(),
    quarter: z.number().nullable(),
    year: z.number().nullable(),
    epsEstimate: z.number().nullable(),
    revenueEstimate: z.number().nullable(),
    lastDate: z.string().nullable(),
    lastQuarter: z.number().nullable(),
    lastYear: z.number().nullable(),
    lastEpsEstimate: z.number().nullable(),
    lastEpsActual: z.number().nullable(),
    lastRevenueEstimate: z.number().nullable(),
    lastRevenueActual: z.number().nullable(),
    lastEpsSurprisePct: z.number().nullable(),
    lastRevenueSurprisePct: z.number().nullable(),
    providerStatus: z.string()
  })
  .nullable();

export const stockDetailSchema = z.object({
  ticker: z.string(),
  companyName: z.string(),
  market: marketEnum,
  status: cardStatusEnum,
  statusReason: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string().nullable(),
  changePct: z.number().nullable(),
  priceStatus: priceStatusEnum,
  held: z.boolean(),
  returnPct: z.number().nullable(),
  asOf: z.string().nullable(),
  earnings: earningsSchema,
  series: stockDetailSeriesSchema,
  fundamentals: stockDetailFundamentalsSchema,
  events: z.array(stockDetailEventSchema),
  watchRules: z.array(stockDetailFalsifierSchema),
  profile: stockDetailProfileSchema,
  earningsDashboard: earningsDashboardSchema.optional()
});
export const watchStockResponseSchema = okEnvelope(z.object({ stock: stockDetailSchema }));

export const watchTrackRequestSchema = z.object({ ticker: z.string(), name: z.string().optional() });
export const watchTrackResponseSchema = okEnvelope(
  z.object({ tracked: z.literal(true), ticker: z.string() })
);

export const watchUntrackRequestSchema = z.object({ ticker: z.string() });
export const watchUntrackResponseSchema = okEnvelope(
  z.object({ untracked: z.literal(true), ticker: z.string() })
);
