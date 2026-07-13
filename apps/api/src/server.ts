import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.API_PORT || 4180);

serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(`Echo API is running at http://${info.address}:${info.port}`);
});
