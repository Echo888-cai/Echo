import { serve } from "@hono/node-server";
import { startTelemetry } from "@echo/observability";

startTelemetry("echo-api");

const { app } = await import("./app.js");

const port = Number(process.env.API_PORT || 4180);
const hostname = process.env.API_HOST || "127.0.0.1";

serve({ fetch: app.fetch, hostname, port }, (info) => {
  console.log(`Echo API is running at http://${info.address}:${info.port}`);
});
