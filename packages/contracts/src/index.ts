/**
 * @echo/contracts — R-0 contract layer.
 *
 * Zod schemas describing Echo Research's CURRENT HTTP API (as implemented in
 * src/server/routes/*.js and wired in server.js). This is a descriptive snapshot,
 * not a forward-looking spec: it exists so the Hono + tRPC rebuild (docs/PLAN.md
 * §4 step 2) has something concrete to diff behavior against.
 */
export * from "./envelope.js";
export * from "./auth.js";
export * from "./companies.js";
export * from "./portfolio.js";
export * from "./preferences.js";
export * from "./notifications.js";
export * from "./portraits.js";
export * from "./watch.js";
export * from "./research.js";
export * from "./status.js";
export * from "./events.js";
export * from "./hkFinancials.js";
export * from "./documents.js";
export * from "./chat.js";
export * from "./ask.js";
export * from "./discover.js";
export * from "./reports.js";
