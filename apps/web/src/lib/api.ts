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

/**
 * 用户主动取消**不是** API 错误，必须原样穿过去。
 *
 * tRPC 把底层 abort 包成 TRPCClientError（message "signal is aborted without reason"，
 * cause 才是真正的 DOMException("AbortError")）。下面的 `new ApiError(error.message, ...)`
 * 会把整条 cause 链丢掉，于是调用方再也认不出"这是用户点了停止"，只能把它当故障渲染成
 * "深度研究失败：signal is aborted without reason"——把一个正常操作报成报错。
 * （这是实测出来的：只读代码会以为 isAbort 能顺着 cause 扒到，实际 cause 早在这里没了。）
 *
 * 判定放在这里而不是各调用方：rpc() 是所有 tRPC 调用的唯一收口，
 * 在这里放行一次，全部调用方都不必各自去猜错误形状。
 */
function isAbortError(error: unknown): boolean {
  for (let e: any = error, depth = 0; e && depth < 5; e = e.cause, depth++) {
    if (e instanceof DOMException && e.name === "AbortError") return true;
    if (e?.name === "AbortError") return true;
  }
  return false;
}

async function rpc<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (isAbortError(error)) throw error;
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

export const membershipApi = {
  async overview() {
    return rpc(trpc.membership.overview.query());
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
  // signal：深度报告是全站最长的操作（实测 21–25s，比对话回答还久），没有中止把手时
  // 用户只能干等。tRPC 的 mutate 支持第二参数传 AbortSignal，透到 fetch 上。
  async generate(body: Record<string, unknown>, signal?: AbortSignal) {
    return rpc(trpc.reports.generate.mutate(body as any, { signal })) as Promise<ReportResult>;
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
  callbacks: { onToken?: (text: string) => void; onReasoning?: (chars: number) => void; onStage?: (stage: string, plan?: string[]) => void } = {},
  signal?: AbortSignal
): Promise<ChatResult> {
  let finalResult: ChatResult | null = null;
  try {
    const resp = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Echo-Auth": "1" },
      body: JSON.stringify({ ...body, stream: true }),
      signal
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
          if (json.stage) callbacks.onStage?.(json.stage, Array.isArray(json.plan) ? json.plan : undefined);
        } else if (evt === "final") {
          finalResult = json;
        } else if (evt === "error") {
          throw new Error(json.message || "流式作答失败");
        }
      }
    }
  } catch (error) {
    // 用户主动取消**不是**故障，绝不能走下面的兜底重跑——那会让"停止"变成"再跑一遍"
    // （非流式的 askApi.ask 还会完整跑完取数+模型+落库，用户点了停止反而更贵）。
    // 原样抛出，由调用方识别 AbortError 并静默收尾。
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    // 认证失败绝不能再走非流式兜底：那会把同一个未授权请求重放一次，
    // 既掩盖真正原因，也让研究页停留在一个看似可用、实际永远失败的状态。
    if (error instanceof ApiError && error.status === 401) throw error;
    if (!finalResult) finalResult = await askApi.ask(body);
  }
  return finalResult!;
}

export const feedbackApi = {
  async submit(message: string, context: Record<string, unknown> | null = null) {
    return rpc(trpc.feedback.submit.mutate({ message, context }));
  }
};
