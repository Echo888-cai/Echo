// Typed tRPC and Hono SSE client with shared zod contracts and CSRF handling.
import {
  authLoginRequestSchema,
  authRegisterRequestSchema,
  type publicUserSchema,
  type statusResponseSchema,
  type schedulerStatusResponseSchema,
  type notificationsListResponseSchema,
  type notificationsUnreadResponseSchema,
  type notificationsTestResponseSchema,
  type researchScorecardResponseSchema,
  type userPreferencesSchema,
  type preferencesUpdateRequestSchema,
  type companySearchResultSchema,
  type companyVerifyResponseSchema,
  type resolvedCompanySchema,
  type portfolioPositionSchema,
  type portfolioReviewSchema,
  type portfolioSnapshotRowSchema,
  type portfolioUpsertRequestSchema,
  type companyProfileSchema,
  type tickerScorecardSchema,
  type conversationGroupSchema,
  type sessionSummarySchema,
  type researchSessionSchema,
  type parsedDocumentSchema,
  type watchCardSchema,
  type watchDeskSchema,
  type stockDetailSchema
} from "@echo/contracts";
import { z } from "zod";
import { isTrpcError, isUnauthorizedTrpc, trpc } from "./trpc";

export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>;
export type AuthRegisterRequest = z.infer<typeof authRegisterRequestSchema>;
export type ApiStatus = z.infer<typeof statusResponseSchema>;
export type SchedulerStatus = z.infer<typeof schedulerStatusResponseSchema>["data"];
export type NotificationItem = z.infer<typeof notificationsListResponseSchema>["data"]["notifications"][number];
export type NotificationsList = z.infer<typeof notificationsListResponseSchema>["data"];
export type NotificationsUnread = z.infer<typeof notificationsUnreadResponseSchema>["data"];
export type NotificationTestResult = z.infer<typeof notificationsTestResponseSchema>["data"];
export type ResearchScorecard = z.infer<typeof researchScorecardResponseSchema>["data"];
export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export type PreferencesUpdateRequest = z.infer<typeof preferencesUpdateRequestSchema>;
export type PortfolioPosition = z.infer<typeof portfolioPositionSchema>;
export type PortfolioReview = z.infer<typeof portfolioReviewSchema>;
export type PortfolioSnapshot = z.infer<typeof portfolioSnapshotRowSchema>;
export type PortfolioUpsertRequest = z.infer<typeof portfolioUpsertRequestSchema>;
export type CompanySearchResult = z.infer<typeof companySearchResultSchema>;
export type CompanyVerifyResult = z.infer<typeof companyVerifyResponseSchema>["data"];
export type ResolvedCompany = z.infer<typeof resolvedCompanySchema>;
export type CompanyProfile = z.infer<typeof companyProfileSchema>;
export type TickerScorecard = z.infer<typeof tickerScorecardSchema>;
export type WatchCard = z.infer<typeof watchCardSchema>;
export type WatchStock = z.infer<typeof stockDetailSchema>;
export type WatchDesk = z.infer<typeof watchDeskSchema>;
export type ConversationGroup = z.infer<typeof conversationGroupSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type ResearchSession = z.infer<typeof researchSessionSchema>;
export type ParsedDocument = z.infer<typeof parsedDocumentSchema>;
// chat.js/ask.js/reports.js/discover.js responses are all "loose" per their own
// contract docstrings (LLM + market-data pipeline output, not a fixed DB shape).
export type ChatResult = Record<string, any>;
export type DiscoverResult = Record<string, any>;
export type ReportResult = Record<string, any>;

/** Thrown for any non-2xx response. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Called whenever a request 401s (outside of /api/auth/*), so the caller
 * (AuthContext) can flip its "authRequired" state — the React analogue of
 * the old code's `S.authRequired = true; render();`.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function rpc<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (isUnauthorizedTrpc(error)) {
      onUnauthorized?.();
      throw new ApiError("请先登录", 401);
    }
    if (isTrpcError(error)) {
      throw new ApiError(error.message || "失败了，再试一次", error.data?.httpStatus ?? 500);
    }
    throw error;
  }
}

/**
 * Login/register reject with 401/400 for expected reasons (wrong password,
 * bad invite) — that's the message the user needs to see, not the generic
 * "please log in" redirect flow that `rpc()` applies to protected endpoints.
 */
async function rpcAuth<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (isTrpcError(error)) {
      throw new ApiError(error.message || "失败了，再试一次", error.data?.httpStatus ?? 500);
    }
    throw error;
  }
}

export const authApi = {
  async login(body: AuthLoginRequest) {
    const parsed = authLoginRequestSchema.parse(body);
    return rpcAuth(trpc.auth.login.mutate(parsed));
  },
  async register(body: AuthRegisterRequest) {
    const parsed = authRegisterRequestSchema.parse(body);
    return rpcAuth(trpc.auth.register.mutate(parsed));
  },
  async logout() {
    return rpc(trpc.auth.logout.mutate());
  },
  async me() {
    return rpc(trpc.auth.me.query());
  }
};

/** GET /api/status — flat (non-enveloped) response; owner-only cards read sub-objects off it. */
export const statusApi = {
  async get() {
    return rpc(trpc.status.query());
  }
};

/** GET /api/scheduler/status — settings page notification/scheduler card. */
export const schedulerApi = {
  async status() {
    return rpc(trpc.scheduler.status.query());
  }
};

/** GET /api/research/scorecard — R7 global research scorecard (settings page). */
export const researchApi = {
  async scorecard() {
    return rpc(trpc.research.scorecard.query());
  }
};

export const notificationsApi = {
  async list(limit = 20) {
    return rpc(trpc.notifications.list.query({ limit }));
  },
  async unread() {
    return rpc(trpc.notifications.unread.query());
  },
  async markRead(id: number | string) {
    return rpc(trpc.notifications.read.mutate({ id }));
  },
  async markAllRead() {
    return rpc(trpc.notifications.read.mutate({ all: true }));
  },
  async test() {
    return rpc(trpc.notifications.test.mutate());
  }
};

export const preferencesApi = {
  async get() {
    return rpc(trpc.preferences.get.query());
  },
  async update(patch: PreferencesUpdateRequest) {
    return rpc(trpc.preferences.update.mutate(patch));
  },
  async onboardingProgress() {
    return rpc(trpc.preferences.onboardingProgress.query());
  }
};

/** Portfolio operations. */
export const portfolioApi = {
  async list() {
    return rpc(trpc.portfolio.list.query());
  },
  async review() {
    return rpc(trpc.portfolio.review.query());
  },
  async snapshots() {
    return rpc(trpc.portfolio.snapshots.query());
  },
  async upsert(body: PortfolioUpsertRequest) {
    return rpc(trpc.portfolio.upsert.mutate(body));
  },
  async remove(ticker: string) {
    return rpc(trpc.portfolio.remove.mutate({ ticker }));
  }
};

/** Company search and resolution. */
export const companiesApi = {
  async search(q: string) {
    return rpc(trpc.companies.search.query({ q }));
  },
  async verify(ticker: string) {
    return rpc(trpc.companies.verify.query({ ticker }));
  },
  async resolve(q: string) {
    return rpc(trpc.companies.resolve.query({ q }));
  }
};

/** Watch desk and stock detail. */
export const watchApi = {
  async desk(events = true) {
    return rpc(trpc.watch.desk.query({ events })) as Promise<{ desk: WatchDesk }>;
  },
  async stock(ticker: string) {
    return rpc(trpc.watch.stock.query({ ticker })) as Promise<{ stock: WatchStock }>;
  },
  async track(ticker: string, name?: string) {
    return rpc(trpc.watch.track.mutate({ ticker, name }));
  },
  async untrack(ticker: string) {
    return rpc(trpc.watch.untrack.mutate({ ticker }));
  }
};

/** Company portrait and per-ticker review. */
export const portraitsApi = {
  async profile(ticker: string) {
    return rpc(trpc.portraits.profile.query({ ticker }));
  },
  async review(ticker: string) {
    return rpc(trpc.portraits.review.query({ ticker }));
  }
};

/** Conversation and session history. */
export const researchSessionsApi = {
  async conversations(limit = 30) {
    return rpc(trpc.research.conversations.query({ limit }));
  },
  async get(id: string) {
    return rpc(trpc.research.get.query({ id }));
  },
  async remove(id: string) {
    return rpc(trpc.research.remove.mutate({ id }));
  },
  async clearAll() {
    return rpc(trpc.research.clear.mutate());
  }
};

/** Unified company, screener and macro research entry. */
export const askApi = {
  async ask(body: Record<string, unknown>) {
    return rpc(trpc.ask.mutate(body as any)) as Promise<ChatResult>;
  }
};

/** Temporal-backed deep research. */
export const reportsApi = {
  async generate(body: Record<string, unknown>) {
    return rpc(trpc.reports.generate.mutate(body as any)) as Promise<ReportResult>;
  }
};

/** Composer document parsing. */
export const documentsApi = {
  async parse(body: { name?: string; type?: string; dataUrl: string; ticker?: string | null }) {
    return rpc(trpc.documents.parse.mutate({ ...body, ticker: body.ticker || undefined }));
  }
};

/**
 * Streaming chat reads the /api/ask SSE
 * response (token/reasoning/status/final/error events), falling back to a plain JSON
 * POST if the endpoint doesn't stream or errors before a final event lands
 * (never silently drop the answer). This takes
 * explicit callbacks instead of reaching into global UI state — the caller
 * (researchStore) decides what "foreground" means.
 */
export async function chatStream(
  body: Record<string, unknown>,
  callbacks: { onToken?: (text: string) => void; onReasoning?: (chars: number) => void; onStage?: (stage: string) => void } = {}
): Promise<ChatResult> {
  let finalResult: ChatResult | null = null;
  try {
    const resp = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Echo-Auth": "1" },
      body: JSON.stringify({ ...body, stream: true })
    });
    if (resp.status === 401) {
      onUnauthorized?.();
      throw new ApiError("请先登录", 401);
    }
    const ctype = resp.headers.get("content-type") || "";
    if (!resp.ok || !resp.body || !ctype.includes("text/event-stream")) throw new Error("no-stream");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let evt = "message";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (line === "") {
          evt = "message";
          continue;
        }
        if (line.startsWith("event:")) {
          evt = line.slice(6).trim();
          continue;
        }
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        let json: any;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (evt === "token") {
          callbacks.onToken?.(json.t || "");
        } else if (evt === "reasoning") {
          callbacks.onReasoning?.(json.n || 0);
        } else if (evt === "status") {
          if (json.stage) callbacks.onStage?.(json.stage);
        } else if (evt === "final") {
          finalResult = json;
        } else if (evt === "error") {
          throw new Error(json.message || "流式作答失败");
        }
      }
    }
  } catch {
    if (!finalResult) finalResult = await askApi.ask(body);
  }
  return finalResult!;
}

export const feedbackApi = {
  async submit(message: string, context: Record<string, unknown> | null = null) {
    return rpc(trpc.feedback.submit.mutate({ message, context }));
  }
};
