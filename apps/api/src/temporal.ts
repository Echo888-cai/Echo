import { Client, Connection } from "@temporalio/client";
import { temporalConnectionOptions, temporalNamespace, temporalTaskQueue } from "@echo/application/temporal-config";
import type { ResearchWorkflowInput } from "../../worker/src/workflows.js";

let clientPromise: Promise<Client> | null = null;

async function client() {
  clientPromise ||= Connection.connect(temporalConnectionOptions())
    .then((connection) => new Client({ connection, namespace: temporalNamespace() }));
  return clientPromise;
}

export async function executeResearchWorkflow(input: ResearchWorkflowInput) {
  const temporal = await client();
  return temporal.workflow.execute("deepResearchWorkflow", {
    taskQueue: temporalTaskQueue(),
    workflowId: `research-${input.userId}-${Date.now()}`,
    args: [input]
  });
}

export async function executeFilingWorkflow(input: { market: "HK"; ticker: string; limit?: number; force?: boolean }) {
  const temporal = await client();
  return temporal.workflow.execute("filingIngestionWorkflow", {
    taskQueue: temporalTaskQueue(),
    workflowId: `filing-${input.market}-${input.ticker}-${Date.now()}`,
    args: [input]
  });
}
