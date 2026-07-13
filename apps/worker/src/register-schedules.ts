import { Client, Connection, ScheduleOverlapPolicy } from "@temporalio/client";
import { loadRootEnv } from "@echo/observability";
import { temporalConnectionOptions, temporalNamespace, temporalTaskQueue } from "@echo/application/temporal-config";

loadRootEnv();

const connection = await Connection.connect(temporalConnectionOptions());
const client = new Client({ connection, namespace: temporalNamespace() });
const taskQueue = temporalTaskQueue();

const schedules = [
  { id: "echo-premarket-digest", cron: "0 0 * * 1-5", workflowType: "digestWorkflow", args: [{ slot: "premarket" }] },
  { id: "echo-afterhours-digest", cron: "0 10 * * 1-5", workflowType: "digestWorkflow", args: [{ slot: "afterhours" }] },
  { id: "echo-market-refresh", cron: "*/15 * * * 1-5", workflowType: "marketRefreshWorkflow", args: [{}] },
  { id: "echo-portfolio-snapshot", cron: "0 22 * * 1-5", workflowType: "portfolioSnapshotWorkflow", args: [{}] },
  { id: "echo-falsifier-check", cron: "*/15 * * * 1-5", workflowType: "falsifierCheckWorkflow", args: [{}] },
  { id: "echo-earnings-review", cron: "30 11 * * 1-5", workflowType: "earningsReviewWorkflow", args: [{}] },
  { id: "echo-postgres-backup", cron: "0 18 * * *", workflowType: "postgresBackupWorkflow", args: [{ label: "daily" }] }
];

for (const schedule of schedules) {
  try {
    await client.schedule.create({
      scheduleId: schedule.id,
      action: { type: "startWorkflow", workflowType: schedule.workflowType, taskQueue, args: schedule.args },
      spec: { cronExpressions: [schedule.cron] },
      policies: { overlap: ScheduleOverlapPolicy.SKIP }
    });
    console.log(`[schedule] created ${schedule.id}`);
  } catch (error: any) {
    if (String(error?.message || error).includes("already exists")) console.log(`[schedule] exists ${schedule.id}`);
    else throw error;
  }
}
await connection.close();
