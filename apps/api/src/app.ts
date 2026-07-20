import { Hono } from "hono";
import { randomBytes } from "node:crypto";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import {
  askRequestSchema,
  authInviteRequestSchema,
  authLoginRequestSchema,
  authRegisterRequestSchema,
  companySearchResultSchema,
  companySearchResponseSchema,
  exportRequestSchema,
  feedbackCreateRequestSchema,
  notificationsReadRequestSchema,
  parseDocumentRequestSchema,
  portfolioReviewSchema,
  portfolioUpsertRequestSchema,
  preferencesUpdateRequestSchema,
  reportGenerateRequestSchema,
  statusResponseSchema,
  stockDetailSchema,
  watchDeskSchema,
  watchTrackRequestSchema,
  watchUntrackRequestSchema
} from "@echo/contracts";
import { getFilings, getNextEarnings } from "@echo/data-plane";
import { multiplyDecimal, subtractDecimal, ratioDecimal } from "@echo/finance-native";

import { searchCompanies } from "@echo/db/repositories/companyRepository.js";
import { createInvite } from "@echo/db/repositories/authRepository.js";
import { getSubscription, listPlans } from "@echo/db/repositories/billingRepository.js";
import { getUserDailyUsage } from "@echo/db/repositories/llmAuditRepository.js";
import { insertFeedback } from "@echo/db/repositories/feedbackRepository.js";
import { getUserPreferences, updateUserPreferences } from "@echo/db/repositories/userPreferencesRepository.js";
import { listNotifications, markAllRead, markRead, unreadCount, insertNotification } from "@echo/db/repositories/notificationsRepository.js";
import { clearResearchSessions, deleteResearchSession, getResearchSession, listConversations } from "@echo/db/repositories/researchSessionsRepository.js";
import { getCompanyProfile } from "@echo/db/repositories/companyProfilesRepository.js";
import { deletePosition, listPositions, upsertPosition } from "@echo/db/repositories/portfolioRepository.js";
import { listSnapshots as listPortfolioSnapshots } from "@echo/db/repositories/portfolioSnapshotsRepository.js";
import { getCompanyByTickerComplete, listRecentMarketSnapshots } from "@echo/db/repositories/companyRepository.js";
import { ensureFreshMarketSnapshot } from "@echo/application/market-data";
import { listRules } from "@echo/db/repositories/watchRulesRepository.js";
import { evaluateRule } from "@echo/domain";
import { computeGlobalScorecard, computeTickerScorecard } from "@echo/domain";
import { listSnapshots as listResearchSnapshots, listSnapshotTickers } from "@echo/db/repositories/researchSnapshotsRepository.js";
import { getEarningsCalendarRow } from "@echo/db/repositories/earningsCalendarRepository.js";
import { addToWatch, getHiddenTickers, listWatchAdds, removeFromWatch } from "@echo/db/repositories/watchlistRepository.js";
import { listCompanyProfiles } from "@echo/db/repositories/companyProfilesRepository.js";
import { runAsk, runReport } from "@echo/application/research";
import { resolveCompanyQuery, verifyTickerListing } from "@echo/application/company-resolution";
import { exportResearchMarkdown } from "@echo/application/export";
import { parseDocument } from "./documents.js";
import { executeResearchWorkflow } from "./temporal.js";
import { buildStatusSnapshot } from "./status.js";
import {
  destroySession,
  loginWithPassword,
  multiUserEnabled,
  registerWithInvite,
  requestToken,
  sessionCookie,
  resolveRequestUser
} from "./auth.js";
import { apiError, apiOk, rateLimit } from "./http.js";
import { registerRestRoutes } from "./rest-routes.js";

type User = { id: string; username: string; displayName: string | null; role: "owner" | "member" };
type Context = { user: User | null; request: Request; responseHeaders: Headers };
type Variables = { user: User };

const t = initTRPC.context<Context>().create();
const publicProcedure = t.procedure;
const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  return next({ ctx: { user: ctx.user, request: ctx.request, responseHeaders: ctx.responseHeaders } });
});

const searchInputSchema = z.object({ q: z.string().trim().max(120).default("") });
const searchOutputSchema = z.object({
  companies: z.array(companySearchResultSchema),
  total: z.number().int().nonnegative()
});

const queryText = z.object({ q: z.string().trim().max(120) });
const tickerInput = z.object({ ticker: z.string().trim().min(1).max(32) });
const idInput = z.object({ id: z.string().trim().min(1).max(160) });

function tickerCurrency(ticker: string) {
  return ticker.endsWith(".HK") ? "HKD" : /\.(SS|SZ)$/.test(ticker) ? "CNY" : "USD";
}

/** Mirrors apps/web/src/lib/market.ts detectMarket() so cards carry a real market badge.
 *  "unsupported" = 已停止覆盖（A 股退场后的存量 .SS/.SZ 条目，不静默删除）。 */
function detectMarket(ticker: string): "US" | "HK" | "unsupported" {
  const t = String(ticker || "").trim().toUpperCase().replace(/\s+/g, "");
  if (/\.US$/.test(t)) return "US";
  if (/\.HK$/.test(t)) return "HK";
  if (/\.(SS|SZ)$/.test(t)) return "unsupported";
  if (/^\d{6}$/.test(t)) return "unsupported";
  if (/^\d{1,5}$/.test(t)) return "HK";
  if (/^[A-Z][A-Z.]{0,6}$/.test(t)) return "US";
  return "HK";
}

async function nextEarningsFor(ticker: string): Promise<{ nextDate: string | null } | null> {
  try {
    const { result } = await getNextEarnings(ticker);
    return result.providerStatus === "ok" ? { nextDate: (result as any).nextDate ?? null } : null;
  } catch {
    return null;
  }
}

async function enrichPosition(position: any, userId: string) {
  const [snapshot, company, rules] = await Promise.all([
    ensureFreshMarketSnapshot(position.ticker),
    getCompanyByTickerComplete(position.ticker),
    listRules(position.ticker, userId)
  ]);
  const price = snapshot?.price ?? null;
  let nearestFalsifierRule = null;
  if (price != null && price > 0) {
    for (const rule of rules) {
      const result = evaluateRule(rule, price);
      if (!result.sane || result.distancePct == null) continue;
      if (!nearestFalsifierRule || Math.abs(result.distancePct) < Math.abs(nearestFalsifierRule.distancePct)) {
        nearestFalsifierRule = { ruleId: rule.id, label: rule.label, kind: rule.kind, threshold: rule.threshold, distancePct: result.distancePct, triggered: result.triggered };
      }
    }
  }
  const enriched: any = {
    ...position,
    currentPrice: price,
    currency: company?.currency || tickerCurrency(position.ticker),
    asOf: snapshot?.as_of || null,
    priceStatus: price == null ? "missing" : "ok",
    changePct: snapshot?.change_percent ?? null,
    sector: company?.sector || null,
    industry: company?.industry || null,
    falsifierRuleCount: rules.length,
    nearestFalsifierRule,
    nextEarnings: null
  };
  // 红线4：金额/比率计算不用二进制浮点，改走 Rust 十进制定点内核（@echo/finance-native）——
  // 此前这里是纯 JS number 乘除减，PLAN.md 诊断#10 记录的"存储层 NUMERIC、计算层浮点各占一半"
  // 缺口。currency 只是货币标签，用于跨字段一致性检查（不同货币相减/相除会显式报错），不参与
  // 数值本身。
  const positionCurrency = enriched.currency;
  if (price != null && position.avgCost != null && position.avgCost !== 0) {
    const gain = subtractDecimal(String(price), String(position.avgCost), positionCurrency);
    const returnPct = ratioDecimal(gain.amount, String(position.avgCost), positionCurrency);
    enriched.returnPct = returnPct != null ? Number(returnPct) : null;
    if (position.shares != null) {
      const marketValue = multiplyDecimal(String(price), String(position.shares), positionCurrency);
      const costValue = multiplyDecimal(String(position.avgCost), String(position.shares), positionCurrency);
      enriched.marketValue = Number(marketValue.amount);
      enriched.costValue = Number(costValue.amount);
      enriched.unrealizedPnl = Number(subtractDecimal(marketValue.amount, costValue.amount, positionCurrency).amount);
    }
  }
  if (price && position.stopLoss != null) {
    const diff = subtractDecimal(String(price), String(position.stopLoss), positionCurrency);
    const toStopPct = ratioDecimal(diff.amount, String(price), positionCurrency);
    enriched.toStopPct = toStopPct != null ? Number(toStopPct) : null;
  }
  if (price && position.takeProfit != null) {
    const diff = subtractDecimal(String(position.takeProfit), String(price), positionCurrency);
    const toTakePct = ratioDecimal(diff.amount, String(price), positionCurrency);
    enriched.toTakePct = toTakePct != null ? Number(toTakePct) : null;
  }
  return enriched;
}

async function enrichedPositions(userId: string) {
  return Promise.all((await listPositions(userId)).map((position) => enrichPosition(position, userId)));
}

// Approximate cross-currency rates for portfolio-level weighting only — never
// used for booked P&L or any NUMERIC-backed figure, just this display-only mix.
const USD_RATE: Record<string, number> = { USD: 1, HKD: 1 / 7.8, CNY: 1 / 7.2 };

function portfolioReview(positions: any[]) {
  const totals = new Map<string, { currency: string; marketValue: number; costValue: number; pnl: number }>();
  let totalUsd = 0;
  const usdByTicker: { ticker: string; name: string; usd: number }[] = [];
  const usdByMarket = new Map<string, number>();
  const usdBySector = new Map<string, number>();
  for (const position of positions) {
    if (position.marketValue == null) continue;
    const current = totals.get(position.currency) || { currency: position.currency, marketValue: 0, costValue: 0, pnl: 0 };
    current.marketValue += position.marketValue;
    current.costValue += position.costValue || 0;
    current.pnl += position.unrealizedPnl || 0;
    totals.set(position.currency, current);

    const usd = position.marketValue * (USD_RATE[position.currency] ?? 1);
    totalUsd += usd;
    usdByTicker.push({ ticker: position.ticker, name: position.companyName || position.ticker, usd });
    const market = detectMarket(position.ticker);
    usdByMarket.set(market, (usdByMarket.get(market) || 0) + usd);
    const sector = position.sector || "未核到";
    usdBySector.set(sector, (usdBySector.get(sector) || 0) + usd);
  }
  const pct = (usd: number) => Math.round((usd / totalUsd) * 1000) / 10;
  const weights = totalUsd > 0
    ? usdByTicker.map(({ ticker, name, usd }) => ({ ticker, name, weightPct: pct(usd) })).sort((a, b) => b.weightPct - a.weightPct)
    : [];
  const marketExposure: Record<string, number> = {};
  if (totalUsd > 0) for (const [market, usd] of usdByMarket) marketExposure[market] = pct(usd);
  const sectorWeights = totalUsd > 0
    ? [...usdBySector.entries()].map(([sector, usd]) => ({ sector, weightPct: pct(usd) })).sort((a, b) => b.weightPct - a.weightPct)
    : [];

  const checks: any[] = [];
  for (const position of positions) {
    if (position.currentPrice != null && position.stopLoss != null && position.currentPrice <= position.stopLoss) {
      checks.push({ level: "bad", ticker: position.ticker, text: `${position.companyName} 已触及止损纪律线` });
    }
    if (position.avgCost != null && position.stopLoss == null) checks.push({ level: "warn", ticker: position.ticker, text: `${position.companyName} 尚未设置止损线` });
    if (position.nearestFalsifierRule?.triggered) checks.push({ level: "bad", ticker: position.ticker, text: `${position.companyName} 的证伪条件已越线` });
  }
  return {
    positionCount: positions.length,
    totals: [...totals.values()],
    weights,
    marketExposure,
    sectorWeights,
    checks,
    verdict: positions.length ? (checks.length ? `有 ${checks.length} 项纪律检查需要处理。` : "组合纪律检查通过。") : "还没有持仓记录。"
  };
}

async function watchDesk(userId: string) {
  const [watched, positions, profiles, hidden] = await Promise.all([
    listWatchAdds(userId), listPositions(userId), listCompanyProfiles(100, userId), getHiddenTickers(userId)
  ]);
  const heldTickers = new Set(positions.map((p) => p.ticker));
  const tickers = new Map<string, string>();
  for (const item of [...watched, ...positions, ...profiles]) {
    if (hidden.has(item.ticker)) continue;
    tickers.set(item.ticker, (item as any).companyName || (item as any).nameZh || item.ticker);
  }
  const failures: unknown[] = [];
  const cards = await Promise.all([...tickers].map(async ([ticker, name]) => {
    const held = heldTickers.has(ticker);
    try {
      const [market, profile, rules, earnings] = await Promise.all([
        ensureFreshMarketSnapshot(ticker), getCompanyProfile(ticker, userId), listRules(ticker, userId), nextEarningsFor(ticker)
      ]);
      const price = market?.price ?? null;
      const evaluations = price == null ? [] : rules.map((rule) => evaluateRule(rule, price));
      const falsified = evaluations.some((result) => result.triggered);
      const atRisk = !falsified && evaluations.some((result) => result.distancePct != null && Math.abs(result.distancePct) < 8);
      const events = profile?.events || [];
      const lastEvent = events.length ? events[events.length - 1] : null;
      const position = held ? positions.find((p) => p.ticker === ticker) : null;
      const returnPct = position?.avgCost && price != null ? (price - Number(position.avgCost)) / Number(position.avgCost) : null;
      return {
        ticker, companyName: name, market: detectMarket(ticker),
        status: (falsified ? "falsified" : atRisk ? "at_risk" : "intact") as "falsified" | "at_risk" | "intact",
        price, currency: tickerCurrency(ticker), changePct: market?.change_percent ?? null, priceStatus: (price == null ? "missing" : "ok") as "ok" | "missing",
        held, returnPct, thesis: profile?.thesis || "", confidence: profile?.confidence || "",
        asOf: market?.as_of || null, updatedAt: profile?.updatedAt || market?.as_of || null,
        earnings, spark: null,
        topEvent: lastEvent ? { title: lastEvent.summary, url: lastEvent.evidence?.[0]?.url ?? null } : null
      };
    } catch (error) {
      failures.push({ ticker, message: error instanceof Error ? error.message : String(error) });
      return {
        ticker, companyName: name, market: detectMarket(ticker), status: "intact" as const, price: null, currency: tickerCurrency(ticker),
        changePct: null, priceStatus: "missing" as const, held, returnPct: null, thesis: "", confidence: "",
        asOf: null, updatedAt: null, earnings: null, spark: null, topEvent: null
      };
    }
  }));
  const counts = { falsified: cards.filter((card) => card.status === "falsified").length, atRisk: cards.filter((card) => card.status === "at_risk").length,
    intact: cards.filter((card) => card.status === "intact").length, total: cards.length };
  return { generatedAt: new Date().toISOString(), slot: (new Date().getUTCHours() < 8 ? "premarket" : "afterhours") as "premarket" | "afterhours",
    cards, counts, failures, partial: failures.length > 0 };
}

async function stockDetail(ticker: string, userId: string) {
  const normalized = ticker.toUpperCase();
  const [company, profile, market, rules, earnings, series, positions, earningsRow] = await Promise.all([
    getCompanyByTickerComplete(normalized), getCompanyProfile(normalized, userId), ensureFreshMarketSnapshot(normalized),
    listRules(normalized, userId), nextEarningsFor(normalized), listRecentMarketSnapshots(normalized, 252), listPositions(userId),
    freshEarningsRow(normalized)
  ]);
  const price = market?.price ?? null;
  const evaluated = price == null ? [] : rules.map((rule) => ({ rule, result: evaluateRule(rule, price) }));
  const falsified = evaluated.some(({ result }) => result.triggered);
  const atRisk = !falsified && evaluated.some(({ result }) => result.distancePct != null && Math.abs(result.distancePct) < 8);
  const position = positions.find((p) => p.ticker === normalized) || null;
  const returnPct = position?.avgCost && price != null ? (price - Number(position.avgCost)) / Number(position.avgCost) : null;
  const marketAsOf = market?.as_of || null;

  let events: any[] = [];
  const market3 = detectMarket(normalized);
  if (market3 === "HK") {
    try {
      const { result } = await getFilings(normalized);
      if (result.providerStatus === "ok") {
        events = (result as any).filings.map((f: any) => ({ title: f.title, url: f.url, date: f.publishedAt, severity: "low" as const }));
      }
    } catch { /* filings adapter unavailable — events stays empty, not fabricated */ }
  }

  const earningsDashboard = earningsRow
    ? {
        nextDate: earningsRow.next_date ?? null,
        quarter: earningsRow.quarter ?? null,
        year: earningsRow.year ?? null,
        epsEstimate: earningsRow.eps_estimate ?? null,
        revenueEstimate: earningsRow.revenue_estimate ?? null,
        lastDate: earningsRow.last_date ?? null,
        lastQuarter: earningsRow.last_quarter ?? null,
        lastYear: earningsRow.last_year ?? null,
        lastEpsEstimate: earningsRow.last_eps_estimate ?? null,
        lastEpsActual: earningsRow.last_eps_actual ?? null,
        lastRevenueEstimate: earningsRow.last_revenue_estimate ?? null,
        lastRevenueActual: earningsRow.last_revenue_actual ?? null,
        lastEpsSurprisePct: earningsRow.last_eps_surprise_pct ?? null,
        lastRevenueSurprisePct: earningsRow.last_revenue_surprise_pct ?? null,
        providerStatus: earningsRow.provider_status || "missing"
      }
    : null;

  return {
    ticker: normalized, companyName: company?.nameZh || company?.nameEn || profile?.companyName || normalized,
    market: market3, status: (falsified ? "falsified" : atRisk ? "at_risk" : "intact") as "falsified" | "at_risk" | "intact",
    statusReason: falsified ? (evaluated.find(({ result }) => result.triggered)?.rule.label ?? null) : null,
    price, currency: company?.currency || tickerCurrency(normalized), changePct: market?.change_percent ?? null,
    priceStatus: (price == null ? "missing" : "ok") as "ok" | "missing", held: Boolean(position), returnPct,
    asOf: marketAsOf, earnings,
    // 已停止覆盖的市场不出历史曲线——价格都不再更新了，挂一条永远冻结的旧曲线比空白更误导。
    series: market3 === "unsupported"
      ? { providerStatus: "unavailable" as const, points: [] }
      : { providerStatus: (series.length >= 2 ? "ok" : "unavailable") as "ok" | "unavailable", points: series },
    fundamentals: { status: "unavailable" as const, pe: null, revenueGrowth: null, grossMargin: null, freeCashFlow: null, currency: null },
    events,
    watchRules: evaluated.map(({ rule, result }) => ({
      id: rule.id, label: rule.label, kind: rule.kind, threshold: rule.threshold,
      triggered: result.triggered, sane: result.sane, distancePct: result.distancePct,
      lastTriggeredAt: rule.lastTriggeredAt ?? null, asOf: marketAsOf
    })),
    profile: profile ? { thesis: profile.thesis || null, researchStatus: profile.researchStatus || null, confidence: profile.confidence || null, turnCount: profile.turnCount ?? null, falsifiers: profile.falsifiers || [] } : null,
    earningsDashboard
  };
}

/**
 * Temporal is a hard local dependency for deep reports: no server running →
 * connect() hangs/rejects → the mutation 500s with no explanation. Fall back
 * to the same runReport() the workflow activity calls, and tag the result so
 * the UI can say "degraded" instead of pretending it's the durable path.
 */
async function generateReport(input: unknown, userId: string) {
  try {
    const result: any = await executeResearchWorkflow({ request: input as Record<string, unknown>, userId });
    return { ...result, engine: "temporal" as const };
  } catch (error) {
    console.error("[reports.generate] Temporal 不可达，降级为内联生成", error instanceof Error ? error.message : error);
    const result = await runReport(input as any, userId);
    return { ...result, engine: "inline-fallback" as const, engineNote: "Temporal 未连接，本次报告已降级为同步生成，不具备工作流可重放保障。" };
  }
}

/**
 * earnings_calendar 的行**可能是冻结脏数据**，读之前必须过新鲜度门槛。
 *
 * `upsertEarningsCalendar` 至今没有任何调用方（#28 接通的是 finnhub/hkAdr 两个实时
 * 适配器，供 `getNextEarnings` 用；这张 postgres 缓存表始终没拿到写入方）。表里现存的
 * 行是某个已删除的临时脚本写的，`knowledge_time` 永远不会再变。`getEarningsCalendarRow`
 * 本身不设门槛（14 天上限在 postgresCalendarAdapter 里，不在 repository），所以直接读
 * 等于把死数据当事实。
 *
 * #32 接 F-2 时就踩了这个：当时误以为这张表已有真实数据。今天碰巧无害（冻结的
 * last_date 比任何新快照都旧，computePostEarnings 正好返回 null），但等真财报到货，
 * 这张表还会停在旧日期——那才是会骗人的时候。
 */
const EARNINGS_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

async function freshEarningsRow(ticker: string) {
  const row = await getEarningsCalendarRow(ticker).catch(() => null);
  if (!row?.fetched_at) return null;
  return Date.now() - new Date(row.fetched_at).getTime() > EARNINGS_CACHE_MAX_AGE_MS ? null : row;
}

async function scorecardFor(ticker: string, userId: string) {
  // earningsRow 驱动 F-2「快照之后有没有新财报到货」（postEarnings / epsBeatRate）。
  // 拿不到（含缓存超龄）时 computeTickerScorecard 会诚实地把这两项置为 null，
  // 而不是拿旧财报冒充"快照之后的新事实"。
  const [snapshots, market, earningsRow] = await Promise.all([
    listResearchSnapshots(ticker, userId),
    ensureFreshMarketSnapshot(ticker),
    freshEarningsRow(ticker)
  ]);
  return computeTickerScorecard(snapshots, { price: market?.price ?? null }, undefined, earningsRow);
}

export const appRouter = t.router({
  auth: t.router({
    login: publicProcedure.input(authLoginRequestSchema).mutation(async ({ ctx, input }) => {
      const { user, token } = await loginWithPassword(input).catch((error) => {
        throw new TRPCError({ code: "UNAUTHORIZED", message: error instanceof Error ? error.message : "登录失败" });
      });
      ctx.responseHeaders.append("set-cookie", sessionCookie(token));
      return { user };
    }),
    register: publicProcedure.input(authRegisterRequestSchema).mutation(async ({ ctx, input }) => {
      const { user, token } = await registerWithInvite({ ...input, displayName: input.displayName }).catch((error) => {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "注册失败" });
      });
      ctx.responseHeaders.append("set-cookie", sessionCookie(token));
      return { user };
    }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      await destroySession(requestToken(ctx.request));
      ctx.responseHeaders.append("set-cookie", sessionCookie("", { clear: true }));
      return { loggedOut: true as const };
    }),
    me: publicProcedure.query(async ({ ctx }) => ({ user: ctx.user, multiUser: await multiUserEnabled() })),
    invite: protectedProcedure.input(authInviteRequestSchema).mutation(async ({ ctx, input }) => {
      if (!await multiUserEnabled()) throw new TRPCError({ code: "CONFLICT", message: "请先用管理命令创建 owner 账号" });
      if (ctx.user.role !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "只有 owner 能生成邀请码" });
      const code = `echo-${randomBytes(4).toString("hex")}`;
      await createInvite(code, { note: input.note, createdBy: ctx.user.id });
      return { code };
    })
  }),
  membership: t.router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      const [plans, subscription, usage] = await Promise.all([
        listPlans(true),
        getSubscription(ctx.user.id),
        getUserDailyUsage(ctx.user.id)
      ]);
      const activePlan = plans.find((plan) => plan.id === subscription?.planId) || plans.find((plan) => plan.id === "free") || null;
      return {
        account: ctx.user,
        plan: activePlan,
        subscription,
        plans,
        usage,
        billingReady: false
      };
    })
  }),
  status: protectedProcedure.output(statusResponseSchema).query(async ({ ctx }) => statusResponseSchema.parse(await buildStatusSnapshot(ctx.user.id))),
  companies: t.router({
    search: protectedProcedure
      .input(searchInputSchema)
      .output(searchOutputSchema)
      .query(async ({ input }) => {
        const companies = input.q ? await searchCompanies(input.q) : [];
        return { companies, total: companies.length };
      }),
    // 真实的多级解析（DB → 别名底账 → FMP 搜索 → 行情探活 → LLM 兜底），只读不建档；
    // 建档发生在研究链路（resolveResearchCompany）。此前这两个端点只查本地库，
    // 前端注释承诺的 "FMP + LLM" 从未存在——典型配置剧场，已兑现。
    verify: protectedProcedure.input(tickerInput).query(async ({ input }) => verifyTickerListing(input.ticker)),
    resolve: protectedProcedure.input(queryText).query(async ({ ctx, input }) => {
      const { company, reason } = await resolveCompanyQuery(input.q, ctx.user.id);
      if (!company) return { company: null, reason: reason || "not_found" };
      return { company: { ticker: company.ticker, nameZh: company.nameZh, ...(company.nameEn ? { nameEn: company.nameEn } : {}), ...(company.industry ? { industry: company.industry } : {}) } };
    })
  }),
  scheduler: t.router({
    status: protectedProcedure.query(() => ({ scheduler: { engine: "temporal", status: "configured", polling: false } }))
  }),
  research: t.router({
    scorecard: protectedProcedure.query(async ({ ctx }) => {
      const tickers = await listSnapshotTickers(ctx.user.id);
      const perTicker = await Promise.all(tickers.map(async ({ ticker }) => ({ ticker, scorecard: await scorecardFor(ticker, ctx.user.id) })));
      return { global: computeGlobalScorecard(perTicker), perTicker };
    }),
    conversations: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(50).default(30) })).query(async ({ ctx, input }) => {
      const conversations = await listConversations({ limit: input.limit, userId: ctx.user.id });
      return { conversations, count: conversations.length };
    }),
    get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
      const session = await getResearchSession(input.id, ctx.user.id);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "未找到研究会话" });
      return { session, report: null };
    }),
    remove: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
      if (!await deleteResearchSession(input.id, ctx.user.id)) throw new TRPCError({ code: "NOT_FOUND", message: "未找到研究会话" });
      return { deleted: true as const, sessionId: input.id };
    }),
    clear: protectedProcedure.mutation(async ({ ctx }) => ({ deleted: await clearResearchSessions(ctx.user.id), cleared: true as const }))
  }),
  notifications: t.router({
    list: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(20) })).query(async ({ ctx, input }) => ({
      notifications: await listNotifications(input.limit, ctx.user.id), unread: await unreadCount(ctx.user.id)
    })),
    unread: protectedProcedure.query(async ({ ctx }) => ({ unread: await unreadCount(ctx.user.id) })),
    read: protectedProcedure.input(notificationsReadRequestSchema).mutation(async ({ ctx, input }) => {
      if ("all" in input) await markAllRead(ctx.user.id); else await markRead(input.id, ctx.user.id);
      return { unread: await unreadCount(ctx.user.id) };
    }),
    test: protectedProcedure.mutation(async ({ ctx }) => {
      await insertNotification({ kind: "system", title: "通知通道测试", body: "Echo Research 通知中心工作正常。", userId: ctx.user.id });
      return { inserted: true as const };
    })
  }),
  preferences: t.router({
    get: protectedProcedure.query(async ({ ctx }) => ({ preferences: await getUserPreferences(ctx.user.id) })),
    update: protectedProcedure.input(preferencesUpdateRequestSchema).mutation(async ({ ctx, input }) => ({ preferences: await updateUserPreferences(ctx.user.id, input) }))
  }),
  portfolio: t.router({
    list: protectedProcedure.query(async ({ ctx }) => ({ positions: await enrichedPositions(ctx.user.id) })),
    review: protectedProcedure.output(z.object({ review: portfolioReviewSchema })).query(async ({ ctx }) => ({ review: portfolioReview(await enrichedPositions(ctx.user.id)) })),
    snapshots: protectedProcedure.query(async ({ ctx }) => ({ snapshots: await listPortfolioSnapshots(180, ctx.user.id) })),
    upsert: protectedProcedure.input(portfolioUpsertRequestSchema).mutation(async ({ ctx, input }) => {
      const number = (value: string | number | undefined) => value == null || value === "" ? undefined : Number(value);
      const saved = await upsertPosition(input.ticker, { ...input, shares: number(input.shares), avgCost: number(input.avgCost), stopLoss: number(input.stopLoss), takeProfit: number(input.takeProfit) }, ctx.user.id);
      return { position: await enrichPosition(saved, ctx.user.id) };
    }),
    remove: protectedProcedure.input(tickerInput).mutation(async ({ ctx, input }) => {
      if (!await deletePosition(input.ticker, ctx.user.id)) throw new TRPCError({ code: "NOT_FOUND", message: "未找到该持仓" });
      return { deleted: true as const, ticker: input.ticker };
    })
  }),
  watch: t.router({
    desk: protectedProcedure.input(z.object({ events: z.boolean().default(true) })).output(z.object({ desk: watchDeskSchema })).query(async ({ ctx }) => ({ desk: await watchDesk(ctx.user.id) })),
    stock: protectedProcedure.input(tickerInput).output(z.object({ stock: stockDetailSchema })).query(async ({ ctx, input }) => ({ stock: await stockDetail(input.ticker, ctx.user.id) })),
    track: protectedProcedure.input(watchTrackRequestSchema).mutation(async ({ ctx, input }) => {
      await addToWatch(input.ticker, input.name, ctx.user.id); return { tracked: true as const, ticker: input.ticker };
    }),
    untrack: protectedProcedure.input(watchUntrackRequestSchema).mutation(async ({ ctx, input }) => {
      await removeFromWatch(input.ticker, ctx.user.id); return { untracked: true as const, ticker: input.ticker };
    })
  }),
  portraits: t.router({
    profile: protectedProcedure.input(tickerInput).query(async ({ ctx, input }) => {
      const profile = await getCompanyProfile(input.ticker, ctx.user.id);
      if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "未找到该公司画像" });
      return { profile, markdown: profile.profileMd };
    }),
    review: protectedProcedure.input(tickerInput).query(async ({ ctx, input }) => ({ ticker: input.ticker.toUpperCase(), scorecard: await scorecardFor(input.ticker, ctx.user.id) }))
  }),
  ask: protectedProcedure.input(askRequestSchema).mutation(({ ctx, input }) => runAsk(input, ctx.user.id)),
  reports: t.router({
    generate: protectedProcedure.input(reportGenerateRequestSchema).mutation(({ ctx, input }) => generateReport(input, ctx.user.id))
  }),
  documents: t.router({
    parse: protectedProcedure.input(parseDocumentRequestSchema).mutation(async ({ ctx, input }) => ({ document: await parseDocument(input, ctx.user.id) }))
  }),
  exports: t.router({
    research: protectedProcedure.input(exportRequestSchema).mutation(async ({ ctx, input }) => {
      const markdown = await exportResearchMarkdown(input, ctx.user.id);
      return { markdown };
    })
  }),
  feedback: t.router({
    submit: protectedProcedure.input(feedbackCreateRequestSchema).mutation(async ({ ctx, input }) => ({
      id: await insertFeedback(ctx.user.id, input.message, input.context), received: true as const
    }))
  })
});

export type AppRouter = typeof appRouter;

async function requestUser(request: Request): Promise<User | null> {
  const user = await resolveRequestUser(request);
  if (!user) return null;
  return { ...user, role: user.role === "owner" ? "owner" : "member" };
}

export function createApp() {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((error, c) => {
    console.error("[api]", error);
    return c.json(apiError(500, "服务暂时不可用"), 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true, service: "echo-api" }));

  const secure = async (c: any, next: any) => {
    const heavyTrpc = c.req.path.startsWith("/trpc/") && /(?:ask|reports\.generate|documents\.parse)/.test(c.req.path);
    const ratePath = heavyTrpc ? "/api/ask" : c.req.path;
    const limited = await rateLimit(c.req.raw, ratePath);
    if (limited) return c.json(apiError(limited.status, limited.message), 429);
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("x-echo-auth") !== "1") {
      return c.json(apiError(403, "缺少校验请求头（请从 Echo Research 页面发起请求）"), 403);
    }
    if (c.req.path.startsWith("/api/auth/") || c.req.path.startsWith("/trpc/auth.")) {
      await next();
      return;
    }
    const user = await requestUser(c.req.raw);
    if (!user) return c.json(apiError(401, "请先登录"), 401);
    c.set("user", user);
    await next();
  };

  app.use("/api/*", secure);
  app.use("/trpc/*", secure);

  // REST/OpenAPI 与 tRPC 共用同一业务函数，保持唯一业务语义。
  app.get("/api/status", async (c) => {
    const body = statusResponseSchema.parse(await buildStatusSnapshot(c.get("user").id));
    return c.json(body);
  });

  app.get("/api/companies/search", async (c) => {
    const input = searchInputSchema.parse({ q: c.req.query("q") || "" });
    const companies = input.q ? await searchCompanies(input.q) : [];
    const body = companySearchResponseSchema.parse(apiOk({ companies, total: companies.length }));
    return c.json(body);
  });

  registerRestRoutes(app, async (c, responseHeaders) => appRouter.createCaller({
    user: await requestUser(c.req.raw),
    request: c.req.raw,
    responseHeaders
  }));

  app.all("/trpc/*", async (c) => {
    const responseHeaders = new Headers();
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: async () => ({ user: await requestUser(c.req.raw), request: c.req.raw, responseHeaders })
    });
    const headers = new Headers(response.headers);
    responseHeaders.forEach((value, key) => headers.append(key, value));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });

  return app;
}

export const app = createApp();
