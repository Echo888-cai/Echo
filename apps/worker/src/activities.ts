import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { financialsDataFor, runReport } from "@echo/application/research";
import { ensureFreshMarketSnapshot } from "@echo/application/market-data";
import { listWithLastReported } from "@echo/db/repositories/earningsCalendarRepository.js";
import { getCompanyProfile, appendProfileEvent, listCompanyProfiles } from "@echo/db/repositories/companyProfilesRepository.js";
import { listAllActiveRules, markTriggered } from "@echo/db/repositories/watchRulesRepository.js";
import { listPositions } from "@echo/db/repositories/portfolioRepository.js";
import { listWatchAdds } from "@echo/db/repositories/watchlistRepository.js";
import { computePortfolioValuationUsd, upsertSnapshot } from "@echo/db/repositories/portfolioSnapshotsRepository.js";
import { insertNotification } from "@echo/db/repositories/notificationsRepository.js";
import { ingestHkFinancials } from "./pipelines/hkFilingsPipeline.js";
import { evaluateFundamentalRule, evaluateRule } from "@echo/domain";
import { listUsers } from "@echo/db/repositories/authRepository.js";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const execFileAsync = promisify(execFile);

export async function validateResearchRequest(input: { request: Record<string, unknown>; userId: string }) {
  if (!String(input.request.question || "").trim()) throw new Error("研究问题不能为空");
  if (!input.userId) throw new Error("userId 不能为空");
  return input;
}

export async function generateResearchReport(input: { request: Record<string, unknown>; userId: string }) {
  return runReport(input.request as any, input.userId);
}

export async function validateFilingRequest(input: { market: "HK"; ticker: string }) {
  if (!input.ticker) throw new Error("ticker 不能为空");
  if (!input.ticker.toUpperCase().endsWith(".HK")) throw new Error("港股 workflow 只接受 .HK ticker");
  return true;
}

export async function ingestHkFilings(input: { ticker: string; limit?: number; force?: boolean }) {
  return ingestHkFinancials(input.ticker, { limit: input.limit, force: input.force });
}

export async function listTenantIds() {
  return (await listUsers()).map((user) => user.id);
}

export async function loadEarningsReviewCandidates() {
  return listWithLastReported();
}

export async function reviewEarningsCandidate(input: any) {
  const profile = await getCompanyProfile(input.ticker, input.userId);
  const summary = `业绩事实已更新：EPS actual ${input.last_eps_actual ?? "未核到"}，estimate ${input.last_eps_estimate ?? "未核到"}。`;
  if (profile) await appendProfileEvent(input.ticker, { date: input.last_date || "", kind: "earnings_report", summary }, input.userId);
  await insertNotification({ kind: "earnings_review", title: `${profile?.companyName || input.ticker} 业绩闭环`, body: summary, ticker: input.ticker, userId: input.userId,
    dedupeKey: `earnings:${input.ticker}:${input.last_date}` });
  return { ticker: input.ticker, summary };
}

export async function buildDigest(input: { userId: string; slot: string }) {
  const rules = await listAllActiveRules(input.userId);
  const generatedAt = new Date().toISOString();
  await insertNotification({ kind: "event_digest", title: input.slot === "premarket" ? "盘前研究速报" : "盘后研究速报",
    body: `当前有 ${rules.length} 条有效监控条件。`, userId: input.userId, dedupeKey: `digest:${input.slot}:${generatedAt.slice(0, 10)}` });
  return { generatedAt, slot: input.slot, activeRuleCount: rules.length };
}

/**
 * 证伪条件巡检。规则有两类，核对口径完全不同，必须分流：
 * - price_below/above：阈值是股价，用实时行情核对。
 * - fundamental_below/above（F-3）：阈值是毛利率/净利率/增速等财报口径，必须用
 *   financialsData 核对。evaluateRule 对这类规则一律返回 sane:false（它自己就地拦截，
 *   防止调用方拿毛利率阈值当股价比），所以过去这些规则登记了也永远不会被触发。
 * 每个 ticker 的财报口径取一次就缓存：同一只票常有多条基本面规则，没必要重复取数。
 */
export async function checkFalsifiers(userId: string) {
  const rules = await listAllActiveRules(userId);
  const triggered = [];
  const financialsCache = new Map<string, any>();
  for (const rule of rules) {
    const isFundamental = rule.kind === "fundamental_below" || rule.kind === "fundamental_above";
    let result;
    let detail = rule.label;
    if (isFundamental) {
      // 登记不全的规则一律不核对：threshold 为 null 时 `currentValue >= null` 会被 JS
      // 强制成 `>= 0`，让每一条 fundamental_above 规则恒真误报。缺字段就是没登记好，
      // 不是"安全"，更不能猜。
      if (rule.metric == null || rule.threshold == null) continue;
      if (!financialsCache.has(rule.ticker)) {
        financialsCache.set(rule.ticker, await financialsDataFor(rule.ticker).catch(() => null));
      }
      result = evaluateFundamentalRule({ kind: rule.kind, metric: rule.metric, threshold: rule.threshold }, financialsCache.get(rule.ticker));
      // 触线时把当期实测值一并说明——"毛利率跌破 55%"本身不告诉用户现在是多少。
      if (result.triggered && result.currentValue != null) detail = `${rule.label}（当前 ${Number(result.currentValue).toFixed(1)}）`;
    } else {
      const market = await ensureFreshMarketSnapshot(rule.ticker);
      if (market?.price == null) continue;
      result = evaluateRule(rule, market.price);
    }
    if (!result.triggered) continue;
    triggered.push({ ticker: rule.ticker, ruleId: rule.id });
    await insertNotification({ kind: "falsify_alert", title: `${rule.ticker} 证伪条件触线`, body: detail, ticker: rule.ticker, userId,
      dedupeKey: `falsifier:${rule.id}` });
    // 重复推送由 notifications 的 dedupeKey 挡，但 last_triggered_at 从来没人写，
    // watch_rules.lastTriggeredAt 便一直是 null——"这条线到底触没触过"无从回溯。
    await markTriggered(rule.id, userId);
  }
  return { checked: rules.length, triggered };
}

export async function refreshMarketSnapshots() {
  const userIds = await listTenantIds();
  const tickers = new Set<string>();
  for (const userId of userIds) {
    for (const position of await listPositions(userId)) tickers.add(position.ticker);
    for (const item of await listWatchAdds(userId)) tickers.add(item.ticker);
    for (const profile of await listCompanyProfiles(200, userId)) tickers.add(profile.ticker);
  }
  const failed: string[] = [];
  let refreshed = 0;
  for (const ticker of tickers) {
    const snapshot = await ensureFreshMarketSnapshot(ticker);
    if (snapshot?.price != null) refreshed += 1;
    else failed.push(ticker);
  }
  return { total: tickers.size, refreshed, failed };
}

const FX_TICKERS: Record<string, string> = { HKD: "HKDUSD=X", CNY: "CNYUSD=X" };

export async function capturePortfolioSnapshots() {
  const userIds = await listTenantIds();
  const date = new Date().toISOString().slice(0, 10);
  const fx: Record<string, string> = {};
  for (const [currency, ticker] of Object.entries(FX_TICKERS)) {
    const snapshot = await ensureFreshMarketSnapshot(ticker);
    if (snapshot?.price != null) fx[currency] = String(snapshot.price);
  }
  const results = [];
  for (const userId of userIds) {
    const valuation = await computePortfolioValuationUsd(fx, userId);
    if (!valuation.positionCount) continue;
    if (valuation.missingPrice || valuation.missingFx || valuation.totalValueUsd == null) {
      // 净值缺日即断口：价格或汇率未核到就不落当日快照，不插值、不回填。
      results.push({ userId, date, skipped: true, missingPrice: valuation.missingPrice, missingFx: valuation.missingFx });
      continue;
    }
    await upsertSnapshot({ date, totalValueUsd: valuation.totalValueUsd, totalCostUsd: valuation.totalCostUsd,
      totalPnlUsd: valuation.totalPnlUsd, positionCount: valuation.positionCount, totals: valuation.totals }, userId);
    results.push({ userId, date, totalValueUsd: valuation.totalValueUsd, positionCount: valuation.positionCount });
  }
  return results;
}

export async function createPostgresBackup(label: string) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const directory = process.env.ECHO_BACKUP_DIR || join(process.cwd(), "backups", "postgres");
  await mkdir(directory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(directory, `echo-${label}-${timestamp}.dump`);
  await execFileAsync("pg_dump", ["--format=custom", "--file", path, process.env.DATABASE_URL], { timeout: 10 * 60_000 });
  const bucket = process.env.ECHO_BACKUP_BUCKET;
  if (!bucket) return { path, createdAt: new Date().toISOString() };
  const key = `postgres/${new Date().toISOString().slice(0, 10)}/${path.split("/").at(-1)}`;
  await new Upload({ client: new S3Client({ region: process.env.AWS_REGION || "ap-east-1" }),
    params: { Bucket: bucket, Key: key, Body: createReadStream(path), ServerSideEncryption: "AES256" } }).done();
  await rm(path);
  return { bucket, key, createdAt: new Date().toISOString() };
}

export async function checkPositionAlerts(userId: string) {
  const positions = await listPositions(userId);
  const alerts = [];
  for (const pos of positions) {
    if (pos.stopLoss == null && pos.takeProfit == null) continue;
    const market = await ensureFreshMarketSnapshot(pos.ticker);
    if (market?.price == null) continue;
    const price = Number(market.price);
    const stopLoss = pos.stopLoss ? Number(pos.stopLoss) : null;
    const takeProfit = pos.takeProfit ? Number(pos.takeProfit) : null;

    if (stopLoss != null && price <= stopLoss) {
      await insertNotification({
        kind: "position_alert",
        title: `${pos.companyName || pos.ticker} 触及止损线`,
        body: `现价 ${price.toFixed(2)}，止损线 ${stopLoss.toFixed(2)}`,
        ticker: pos.ticker,
        userId,
        dedupeKey: `position:stop:${pos.ticker}`
      });
      alerts.push({ ticker: pos.ticker, type: "stop_loss", price, threshold: stopLoss });
    }
    if (takeProfit != null && price >= takeProfit) {
      await insertNotification({
        kind: "position_alert",
        title: `${pos.companyName || pos.ticker} 触及止盈线`,
        body: `现价 ${price.toFixed(2)}，止盈线 ${takeProfit.toFixed(2)}`,
        ticker: pos.ticker,
        userId,
        dedupeKey: `position:profit:${pos.ticker}`
      });
      alerts.push({ ticker: pos.ticker, type: "take_profit", price, threshold: takeProfit });
    }

    if (pos.avgCost) {
      const avgCost = Number(pos.avgCost);
      const drawdownPct = ((price - avgCost) / avgCost) * 100;
      if (drawdownPct <= -15) {
        await insertNotification({
          kind: "position_alert",
          title: `${pos.companyName || pos.ticker} 大幅回撤`,
          body: `现价 ${price.toFixed(2)}，成本 ${avgCost.toFixed(2)}，回撤 ${drawdownPct.toFixed(1)}%`,
          ticker: pos.ticker,
          userId,
          dedupeKey: `position:drawdown:${pos.ticker}:${Math.floor(drawdownPct / 5) * 5}`
        });
        alerts.push({ ticker: pos.ticker, type: "drawdown", price, drawdownPct });
      }
    }
  }
  return { checked: positions.length, alerts };
}

export async function checkReviewReminders(userId: string) {
  const profiles = await listCompanyProfiles(200, userId);
  const reminders = [];
  const now = Date.now();
  const STALE_DAYS = 30;
  for (const profile of profiles) {
    if (!profile.thesis || !profile.updatedAt) continue;
    const updatedAt = new Date(profile.updatedAt).getTime();
    const daysSinceUpdate = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));
    if (daysSinceUpdate >= STALE_DAYS) {
      await insertNotification({
        kind: "review_reminder",
        title: `${profile.companyName || profile.ticker} 研究已 ${daysSinceUpdate} 天未更新`,
        body: `上次更新于 ${new Date(profile.updatedAt).toISOString().slice(0, 10)}，建议复盘当前判断是否仍然成立`,
        ticker: profile.ticker,
        userId,
        dedupeKey: `review:${profile.ticker}:${new Date().toISOString().slice(0, 7)}`,
        dedupeWindowHours: 168
      });
      reminders.push({ ticker: profile.ticker, daysSinceUpdate });
    }
  }
  return { checked: profiles.length, reminders };
}

export async function recordWorkflowCompletion(_input: { workflow: string; userId?: string; referenceId?: string | null }) {
  return true;
}
