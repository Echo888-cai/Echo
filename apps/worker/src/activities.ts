import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { runReport } from "@echo/application/research";
import { listWithLastReported } from "@echo/db/repositories/earningsCalendarRepository.js";
import { getCompanyProfile, appendProfileEvent } from "@echo/db/repositories/companyProfilesRepository.js";
import { listAllActiveRules } from "@echo/db/repositories/watchRulesRepository.js";
import { getLatestMarketSnapshot } from "@echo/db/repositories/companyRepository.js";
import { insertNotification } from "@echo/db/repositories/notificationsRepository.js";
import { ingestHkFinancials } from "./pipelines/hkFilingsPipeline.js";
import { ingestCnFinancials } from "./pipelines/cnFilingsPipeline.js";
import { evaluateRule } from "@echo/domain";
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

export async function validateFilingRequest(input: { market: "HK" | "CN"; ticker: string }) {
  if (!input.ticker) throw new Error("ticker 不能为空");
  if (input.market === "HK" && !input.ticker.toUpperCase().endsWith(".HK")) throw new Error("港股 workflow 只接受 .HK ticker");
  if (input.market === "CN" && !/\.(SS|SZ)$/i.test(input.ticker)) throw new Error("A 股 workflow 只接受 .SS/.SZ ticker");
  return true;
}

export async function ingestHkFilings(input: { ticker: string; limit?: number; force?: boolean }) {
  return ingestHkFinancials(input.ticker, { limit: input.limit, force: input.force });
}

export async function ingestCnFilings(input: { ticker: string; limit?: number; force?: boolean }) {
  return ingestCnFinancials(input.ticker, { limit: input.limit, force: input.force });
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

export async function checkFalsifiers(userId: string) {
  const rules = await listAllActiveRules(userId);
  const triggered = [];
  for (const rule of rules) {
    const market = await getLatestMarketSnapshot(rule.ticker);
    if (market?.price == null) continue;
    const result = evaluateRule(rule, market.price);
    if (!result.triggered) continue;
    triggered.push({ ticker: rule.ticker, ruleId: rule.id });
    await insertNotification({ kind: "falsify_alert", title: `${rule.ticker} 证伪条件触线`, body: rule.label, ticker: rule.ticker, userId,
      dedupeKey: `falsifier:${rule.id}` });
  }
  return { checked: rules.length, triggered };
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

export async function recordWorkflowCompletion(_input: { workflow: string; userId?: string; referenceId?: string | null }) {
  return true;
}
