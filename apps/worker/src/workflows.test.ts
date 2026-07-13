import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";

let environment: TestWorkflowEnvironment;

before(async () => {
  environment = await TestWorkflowEnvironment.createTimeSkipping();
});

after(async () => {
  await environment?.teardown();
});

test("deep research resumes at the failed activity instead of rerunning completed steps", async () => {
  const calls = { validate: 0, generate: 0, complete: 0 };
  const activities: any = {
    async validateResearchRequest(input: any) { calls.validate += 1; return input; },
    async generateResearchReport() {
      calls.generate += 1;
      if (calls.generate === 1) throw new Error("injected activity failure");
      return { sessionId: "temporal-session", markdown: "ok" };
    },
    async recordWorkflowCompletion() { calls.complete += 1; return true; }
  };
  const taskQueue = `test-${Date.now()}`;
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue,
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities
  });
  const result: any = await worker.runUntil(() => environment.client.workflow.execute("deepResearchWorkflow", {
    workflowId: `failure-recovery-${Date.now()}`,
    taskQueue,
    args: [{ request: { question: "test" }, userId: "test" }]
  }));
  assert.equal(result.sessionId, "temporal-session");
  assert.deepEqual(calls, { validate: 1, generate: 2, complete: 1 });
});

test("scheduled digest fans out to every PostgreSQL tenant", async () => {
  const visited: string[] = [];
  const activities: any = {
    async listTenantIds() { return ["tenant-a", "tenant-b"]; },
    async buildDigest(input: { userId: string; slot: string }) {
      visited.push(input.userId);
      return { userId: input.userId, slot: input.slot };
    }
  };
  const taskQueue = `fanout-${Date.now()}`;
  const worker = await Worker.create({
    connection: environment.nativeConnection,
    taskQueue,
    workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
    activities
  });
  const result: any = await worker.runUntil(() => environment.client.workflow.execute("digestWorkflow", {
    workflowId: `tenant-fanout-${Date.now()}`,
    taskQueue,
    args: [{ slot: "premarket" }]
  }));
  assert.deepEqual(visited, ["tenant-a", "tenant-b"]);
  assert.deepEqual(result.map((item: any) => item.userId), ["tenant-a", "tenant-b"]);
});
