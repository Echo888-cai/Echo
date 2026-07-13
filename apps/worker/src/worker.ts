import { loadRootEnv, startTelemetry } from "@echo/observability";
import { temporalConnectionOptions, temporalNamespace, temporalTaskQueue } from "@echo/application/temporal-config";
import { fileURLToPath } from "node:url";

loadRootEnv();
startTelemetry("echo-worker");

const [{ NativeConnection, Worker }, activities] = await Promise.all([
  import("@temporalio/worker"),
  import("./activities.js")
]);

const options = temporalConnectionOptions();
const namespace = temporalNamespace();
const taskQueue = temporalTaskQueue();

const connection = await NativeConnection.connect(options);
const worker = await Worker.create({ connection, namespace, taskQueue, workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)), activities });
console.log(`[worker] Temporal ${namespace}/${taskQueue} @ ${options.address}`);
await worker.run();
