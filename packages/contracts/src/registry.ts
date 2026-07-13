/**
 * OpenAPI registry for the R-0 contract snapshot. Registers every currently-wired
 * endpoint (method + path + request + response) so generate-openapi.ts can emit
 * openapi.json. This is a snapshot of CURRENT behavior, not a target spec.
 */
import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

import {
  authLoginRequestSchema, authLoginResponseSchema,
  authRegisterRequestSchema, authRegisterResponseSchema,
  authLogoutResponseSchema, authMeResponseSchema,
  authInviteRequestSchema, authInviteResponseSchema
} from "./auth.js";
import {
  companySearchResponseSchema, companyVerifyResponseSchema, companyResolveResponseSchema
} from "./companies.js";
import {
  portfolioListResponseSchema, portfolioReviewResponseSchema, portfolioSnapshotsResponseSchema,
  portfolioUpsertRequestSchema, portfolioUpsertResponseSchema, portfolioDeleteResponseSchema
} from "./portfolio.js";
import {
  preferencesGetResponseSchema, preferencesUpdateRequestSchema, preferencesUpdateResponseSchema,
  feedbackCreateRequestSchema, feedbackCreateResponseSchema
} from "./preferences.js";
import {
  notificationsListResponseSchema, notificationsUnreadResponseSchema,
  notificationsReadRequestSchema, notificationsReadResponseSchema,
  notificationsTestResponseSchema, schedulerStatusResponseSchema
} from "./notifications.js";
import {
  profileListResponseSchema, profileGetResponseSchema, profileDeleteResponseSchema,
  profileReviewResponseSchema, researchScorecardResponseSchema
} from "./portraits.js";
import {
  watchDeskResponseSchema, watchStockResponseSchema,
  watchTrackRequestSchema, watchTrackResponseSchema,
  watchUntrackRequestSchema, watchUntrackResponseSchema
} from "./watch.js";
import {
  sessionListResponseSchema, conversationListResponseSchema, sessionClearResponseSchema,
  sessionGetResponseSchema, sessionDeleteResponseSchema
} from "./research.js";
import { statusResponseSchema } from "./status.js";
import { eventsDigestResponseSchema } from "./events.js";
import {
  hkFinancialsListResponseSchema, hkFinancialsIngestResponseSchema
} from "./hkFinancials.js";
import { parseDocumentRequestSchema, parseDocumentResponseSchema } from "./documents.js";
import { chatRequestSchema, chatResponseSchema, chatErrorResponseSchema } from "./chat.js";
import { askRequestSchema, askErrorResponseSchema } from "./ask.js";
import { discoverRequestSchema, discoverResponseSchema, discoverErrorResponseSchema } from "./discover.js";
import {
  reportGenerateRequestSchema, reportGenerateResponseSchema, reportGenerateErrorResponseSchema
} from "./reports.js";

export const registry = new OpenAPIRegistry();

function jsonBody(schema: z.ZodTypeAny) {
  return { body: { content: { "application/json": { schema } } } };
}
function jsonOk(schema: z.ZodTypeAny, description = "OK") {
  return { 200: { description, content: { "application/json": { schema } } } };
}

// ── auth ──────────────────────────────────────────────────────────────────
registry.registerPath({
  method: "post", path: "/api/auth/login", tags: ["auth"],
  request: jsonBody(authLoginRequestSchema), responses: jsonOk(authLoginResponseSchema)
});
registry.registerPath({
  method: "post", path: "/api/auth/register", tags: ["auth"],
  request: jsonBody(authRegisterRequestSchema), responses: jsonOk(authRegisterResponseSchema)
});
registry.registerPath({
  method: "post", path: "/api/auth/logout", tags: ["auth"],
  responses: jsonOk(authLogoutResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/auth/me", tags: ["auth"],
  responses: jsonOk(authMeResponseSchema)
});
registry.registerPath({
  method: "post", path: "/api/auth/invite", tags: ["auth"],
  request: jsonBody(authInviteRequestSchema), responses: jsonOk(authInviteResponseSchema)
});

// ── companies ─────────────────────────────────────────────────────────────
registry.registerPath({
  method: "get", path: "/api/companies/verify", tags: ["companies"],
  responses: jsonOk(companyVerifyResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/companies/resolve", tags: ["companies"],
  responses: jsonOk(companyResolveResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/companies/search", tags: ["companies"],
  responses: jsonOk(companySearchResponseSchema)
});

// ── status / preferences / feedback ─────────────────────────────────────────
registry.registerPath({
  method: "get", path: "/api/status", tags: ["status"],
  responses: jsonOk(statusResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/preferences", tags: ["preferences"],
  responses: jsonOk(preferencesGetResponseSchema)
});
registry.registerPath({
  method: "patch", path: "/api/preferences", tags: ["preferences"],
  request: jsonBody(preferencesUpdateRequestSchema), responses: jsonOk(preferencesUpdateResponseSchema)
});
registry.registerPath({
  method: "post", path: "/api/feedback", tags: ["preferences"],
  request: jsonBody(feedbackCreateRequestSchema), responses: jsonOk(feedbackCreateResponseSchema)
});

// ── documents ────────────────────────────────────────────────────────────
registry.registerPath({
  method: "post", path: "/api/parse-document", tags: ["documents"],
  request: jsonBody(parseDocumentRequestSchema), responses: jsonOk(parseDocumentResponseSchema)
});

// ── ask / chat / discover / report (LLM pipelines; flat, non-enveloped) ───
registry.registerPath({
  method: "post", path: "/api/ask", tags: ["ask"],
  request: jsonBody(askRequestSchema),
  responses: { 200: { description: "Delegates to chat or discover shape", content: { "application/json": { schema: z.unknown() } } }, 400: { description: "Error", content: { "application/json": { schema: askErrorResponseSchema } } } }
});
registry.registerPath({
  method: "post", path: "/api/chat", tags: ["chat"],
  request: jsonBody(chatRequestSchema),
  responses: { ...jsonOk(chatResponseSchema), 400: { description: "Error", content: { "application/json": { schema: chatErrorResponseSchema } } } }
});
registry.registerPath({
  method: "post", path: "/api/report/generate", tags: ["reports"],
  request: jsonBody(reportGenerateRequestSchema),
  responses: { ...jsonOk(reportGenerateResponseSchema), 500: { description: "Error", content: { "application/json": { schema: reportGenerateErrorResponseSchema } } } }
});
registry.registerPath({
  method: "post", path: "/api/discover", tags: ["discover"],
  request: jsonBody(discoverRequestSchema),
  responses: { ...jsonOk(discoverResponseSchema), 400: { description: "Error", content: { "application/json": { schema: discoverErrorResponseSchema } } } }
});

// ── events ───────────────────────────────────────────────────────────────
registry.registerPath({
  method: "get", path: "/api/events/digest", tags: ["events"],
  responses: jsonOk(eventsDigestResponseSchema)
});

// ── hk-financials ────────────────────────────────────────────────────────
registry.registerPath({
  method: "post", path: "/api/hk-financials/ingest", tags: ["hkFinancials"],
  responses: jsonOk(hkFinancialsIngestResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/hk-financials", tags: ["hkFinancials"],
  responses: jsonOk(hkFinancialsListResponseSchema)
});

// ── notifications ────────────────────────────────────────────────────────
registry.registerPath({
  method: "get", path: "/api/notifications/unread", tags: ["notifications"],
  responses: jsonOk(notificationsUnreadResponseSchema)
});
registry.registerPath({
  method: "post", path: "/api/notifications/read", tags: ["notifications"],
  request: jsonBody(notificationsReadRequestSchema), responses: jsonOk(notificationsReadResponseSchema)
});
registry.registerPath({
  method: "post", path: "/api/notifications/test", tags: ["notifications"],
  responses: jsonOk(notificationsTestResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/notifications", tags: ["notifications"],
  responses: jsonOk(notificationsListResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/scheduler/status", tags: ["notifications"],
  responses: jsonOk(schedulerStatusResponseSchema)
});

// ── watch ────────────────────────────────────────────────────────────────
registry.registerPath({
  method: "get", path: "/api/watch/stock", tags: ["watch"],
  responses: jsonOk(watchStockResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/watch/desk", tags: ["watch"],
  responses: jsonOk(watchDeskResponseSchema)
});
registry.registerPath({
  method: "post", path: "/api/watch/track", tags: ["watch"],
  request: jsonBody(watchTrackRequestSchema), responses: jsonOk(watchTrackResponseSchema)
});
registry.registerPath({
  method: "post", path: "/api/watch/untrack", tags: ["watch"],
  request: jsonBody(watchUntrackRequestSchema), responses: jsonOk(watchUntrackResponseSchema)
});

// ── portfolio ────────────────────────────────────────────────────────────
registry.registerPath({
  method: "get", path: "/api/portfolio/review", tags: ["portfolio"],
  responses: jsonOk(portfolioReviewResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/portfolio/snapshots", tags: ["portfolio"],
  responses: jsonOk(portfolioSnapshotsResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/portfolio", tags: ["portfolio"],
  responses: jsonOk(portfolioListResponseSchema)
});
registry.registerPath({
  method: "post", path: "/api/portfolio", tags: ["portfolio"],
  request: jsonBody(portfolioUpsertRequestSchema), responses: jsonOk(portfolioUpsertResponseSchema)
});
registry.registerPath({
  method: "delete", path: "/api/portfolio", tags: ["portfolio"],
  responses: jsonOk(portfolioDeleteResponseSchema)
});

// ── company portraits ────────────────────────────────────────────────────
registry.registerPath({
  method: "get", path: "/api/company/profiles", tags: ["portraits"],
  responses: jsonOk(profileListResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/company/review", tags: ["portraits"],
  responses: jsonOk(profileReviewResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/company/profile", tags: ["portraits"],
  responses: jsonOk(profileGetResponseSchema)
});
registry.registerPath({
  method: "delete", path: "/api/company/profile", tags: ["portraits"],
  responses: jsonOk(profileDeleteResponseSchema)
});

// ── research scorecard ───────────────────────────────────────────────────
registry.registerPath({
  method: "get", path: "/api/research/scorecard", tags: ["research"],
  responses: jsonOk(researchScorecardResponseSchema)
});

// ── research sessions ────────────────────────────────────────────────────
registry.registerPath({
  method: "get", path: "/api/research/conversations", tags: ["research"],
  responses: jsonOk(conversationListResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/research/sessions", tags: ["research"],
  responses: jsonOk(sessionListResponseSchema)
});
registry.registerPath({
  method: "delete", path: "/api/research/sessions", tags: ["research"],
  responses: jsonOk(sessionClearResponseSchema)
});
registry.registerPath({
  method: "get", path: "/api/research/sessions/{id}", tags: ["research"],
  request: { params: z.object({ id: z.string() }) },
  responses: jsonOk(sessionGetResponseSchema)
});
registry.registerPath({
  method: "delete", path: "/api/research/sessions/{id}", tags: ["research"],
  request: { params: z.object({ id: z.string() }) },
  responses: jsonOk(sessionDeleteResponseSchema)
});
