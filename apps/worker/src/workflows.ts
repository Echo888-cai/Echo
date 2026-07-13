import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities.js";

const activity = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { initialInterval: "2 seconds", maximumInterval: "2 minutes", maximumAttempts: 5 }
});

export type ResearchWorkflowInput = { request: Record<string, unknown>; userId: string };

export async function deepResearchWorkflow(input: ResearchWorkflowInput) {
  const validated = await activity.validateResearchRequest(input);
  const report = await activity.generateResearchReport(validated);
  await activity.recordWorkflowCompletion({ workflow: "deep-research", userId: input.userId, referenceId: report.sessionId });
  return report;
}

export async function filingIngestionWorkflow(input: { market: "HK" | "CN"; ticker: string; limit?: number; force?: boolean }) {
  await activity.validateFilingRequest(input);
  const result = input.market === "HK"
    ? await activity.ingestHkFilings(input)
    : await activity.ingestCnFilings(input);
  await activity.recordWorkflowCompletion({ workflow: "filing-ingestion", referenceId: input.ticker });
  return result;
}

export async function earningsReviewWorkflow(input: { userId?: string } = {}) {
  const userIds = input.userId ? [input.userId] : await activity.listTenantIds();
  const candidates = await activity.loadEarningsReviewCandidates();
  const reviews = [];
  for (const userId of userIds) {
    for (const candidate of candidates) reviews.push(await activity.reviewEarningsCandidate({ ...candidate, userId }));
  }
  await activity.recordWorkflowCompletion({ workflow: "earnings-review", userId: input.userId, referenceId: String(reviews.length) });
  return reviews;
}

export async function digestWorkflow(input: { userId?: string; slot: "premarket" | "afterhours" }) {
  const userIds = input.userId ? [input.userId] : await activity.listTenantIds();
  const digests = [];
  for (const userId of userIds) digests.push(await activity.buildDigest({ ...input, userId }));
  return digests;
}

export async function falsifierCheckWorkflow(input: { userId?: string } = {}) {
  const userIds = input.userId ? [input.userId] : await activity.listTenantIds();
  const results = [];
  for (const userId of userIds) results.push(await activity.checkFalsifiers(userId));
  return results;
}

export async function postgresBackupWorkflow(input: { label?: string } = {}) {
  return activity.createPostgresBackup(input.label || "scheduled");
}
