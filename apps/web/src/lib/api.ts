// Typed API client — mirrors src/ui/api.js's fetch wrapper (CSRF header,
// 401 handling contract) but exposes it through @echo/contracts schemas
// instead of loosely-typed JSON, and swaps the old global-mutable
// `S.authRequired` flag for an injectable callback (see AuthContext).
import {
  authLoginRequestSchema,
  authLoginResponseSchema,
  authRegisterRequestSchema,
  authRegisterResponseSchema,
  authLogoutResponseSchema,
  authMeResponseSchema,
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
  type parsedDocumentSchema
} from "@echo/contracts";
import { z } from "zod";

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
// watch.js's routes/services build cards/stock from live market data + best-effort
// portrait joins — the contract itself types them as z.record(string, unknown) (R-0
// scope: loose, not field-exact), so the frontend treats them the same way rather
// than pretending to a precision the contract doesn't have.
export type WatchCard = Record<string, any>;
export type WatchStock = Record<string, any>;
export interface WatchDesk {
  generatedAt: string;
  slot: "premarket" | "afterhours";
  cards: WatchCard[];
  counts: { falsified: number; atRisk: number; intact: number; total: number };
  failures: unknown[];
  partial?: boolean;
}
export type ConversationGroup = z.infer<typeof conversationGroupSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type ResearchSession = z.infer<typeof researchSessionSchema>;
export type ParsedDocument = z.infer<typeof parsedDocumentSchema>;
// chat.js/ask.js/reports.js/discover.js responses are all "loose" per their own
// contract docstrings (LLM + market-data pipeline output, not a fixed DB shape).
export type ChatResult = Record<string, any>;
export type DiscoverResult = Record<string, any>;
export type ReportResult = Record<string, any>;

/** Thrown for any non-2xx response; `.message` matches the legacy api.js contract. */
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

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      // U-1 CSRF: server requires this custom header on all non-GET requests.
      ...(method !== "GET" ? { "X-Echo-Auth": "1" } : {}),
      ...(options.headers || {})
    }
  });

  // U-1: in multi-user mode, an expired session flips the whole app to the
  // login card — except for /api/auth/* itself, so a failed login attempt
  // doesn't also trigger this.
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    onUnauthorized?.();
    throw new ApiError("请先登录", 401);
  }

  const json: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json?.error?.message || json?.error || `请求失败 ${response.status}`;
    throw new ApiError(message, response.status);
  }
  return (json?.ok && json.data ? json.data : json) as T;
}

export const authApi = {
  async login(body: AuthLoginRequest) {
    const parsed = authLoginRequestSchema.parse(body);
    const data = await request<z.infer<typeof authLoginResponseSchema>["data"]>(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify(parsed) }
    );
    return data;
  },
  async register(body: AuthRegisterRequest) {
    const parsed = authRegisterRequestSchema.parse(body);
    const data = await request<z.infer<typeof authRegisterResponseSchema>["data"]>(
      "/api/auth/register",
      { method: "POST", body: JSON.stringify(parsed) }
    );
    return data;
  },
  async logout() {
    return request<z.infer<typeof authLogoutResponseSchema>["data"]>("/api/auth/logout", {
      method: "POST"
    });
  },
  async me() {
    return request<z.infer<typeof authMeResponseSchema>["data"]>("/api/auth/me", {
      method: "GET"
    });
  }
};

/** GET /api/status — flat (non-enveloped) response; owner-only cards read sub-objects off it. */
export const statusApi = {
  async get() {
    return request<ApiStatus>("/api/status", { method: "GET" });
  }
};

/** GET /api/scheduler/status — settings page notification/scheduler card. */
export const schedulerApi = {
  async status() {
    return request<SchedulerStatus>("/api/scheduler/status", { method: "GET" });
  }
};

/** GET /api/research/scorecard — R7 global research scorecard (settings page). */
export const researchApi = {
  async scorecard() {
    return request<ResearchScorecard>("/api/research/scorecard", { method: "GET" });
  }
};

export const notificationsApi = {
  async list(limit = 20) {
    return request<NotificationsList>(`/api/notifications?limit=${limit}`, { method: "GET" });
  },
  async unread() {
    return request<NotificationsUnread>("/api/notifications/unread", { method: "GET" });
  },
  async markRead(id: number | string) {
    return request<NotificationsUnread>("/api/notifications/read", {
      method: "POST",
      body: JSON.stringify({ id })
    });
  },
  async markAllRead() {
    return request<NotificationsUnread>("/api/notifications/read", {
      method: "POST",
      body: JSON.stringify({ all: true })
    });
  },
  async test() {
    return request<NotificationTestResult>("/api/notifications/test", {
      method: "POST",
      body: "{}"
    });
  }
};

export const preferencesApi = {
  async get() {
    return request<{ preferences: UserPreferences }>("/api/preferences", { method: "GET" });
  },
  async update(patch: PreferencesUpdateRequest) {
    return request<{ preferences: UserPreferences }>("/api/preferences", {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  }
};

/** src/server/routes/portfolio.js — used by the portfolio page (R-3 slice 3). */
export const portfolioApi = {
  async list() {
    return request<{ positions: PortfolioPosition[] }>("/api/portfolio", { method: "GET" });
  },
  async review() {
    return request<{ review: PortfolioReview }>("/api/portfolio/review", { method: "GET" });
  },
  async snapshots() {
    return request<{ snapshots: PortfolioSnapshot[] }>("/api/portfolio/snapshots", { method: "GET" });
  },
  async upsert(body: PortfolioUpsertRequest) {
    return request<{ position: PortfolioPosition }>("/api/portfolio", {
      method: "POST",
      body: JSON.stringify(body)
    });
  },
  async remove(ticker: string) {
    return request<{ deleted: true; ticker: string }>(`/api/portfolio?ticker=${encodeURIComponent(ticker)}`, {
      method: "DELETE"
    });
  }
};

/** src/server/routes/companies.js — company search/verify/resolve, used by resolve.ts. */
export const companiesApi = {
  async search(q: string) {
    return request<{ companies: CompanySearchResult[]; total: number }>(
      `/api/companies/search?q=${encodeURIComponent(q)}`,
      { method: "GET" }
    );
  },
  async verify(ticker: string) {
    return request<CompanyVerifyResult>(`/api/companies/verify?ticker=${encodeURIComponent(ticker)}`, {
      method: "GET"
    });
  },
  async resolve(q: string) {
    return request<{ company: ResolvedCompany | null; reason?: string; name?: string }>(
      `/api/companies/resolve?q=${encodeURIComponent(q)}`,
      { method: "GET" }
    );
  }
};

/** src/server/routes/watch.js — watch desk (list) + per-stock detail. */
export const watchApi = {
  async desk(events = true) {
    return request<{ desk: WatchDesk }>(`/api/watch/desk${events ? "" : "?events=0"}`, { method: "GET" });
  },
  async stock(ticker: string) {
    return request<{ stock: WatchStock }>(`/api/watch/stock?ticker=${encodeURIComponent(ticker)}`, {
      method: "GET"
    });
  },
  async track(ticker: string, name?: string) {
    return request<{ tracked: true; ticker: string }>("/api/watch/track", {
      method: "POST",
      body: JSON.stringify({ ticker, name })
    });
  },
  async untrack(ticker: string) {
    return request<{ untracked: true; ticker: string }>("/api/watch/untrack", {
      method: "POST",
      body: JSON.stringify({ ticker })
    });
  }
};

/** src/server/routes/portraits.js — company profile (画像) + per-ticker research review. */
export const portraitsApi = {
  async profile(ticker: string) {
    return request<{ profile: CompanyProfile; markdown: string }>(
      `/api/company/profile?ticker=${encodeURIComponent(ticker)}`,
      { method: "GET" }
    );
  },
  async review(ticker: string) {
    return request<{ ticker: string; scorecard: TickerScorecard }>(
      `/api/company/review?ticker=${encodeURIComponent(ticker)}`,
      { method: "GET" }
    );
  }
};

/** src/server/routes/research.js — conversation/session history for the research sidebar. */
export const researchSessionsApi = {
  async conversations(limit = 30) {
    return request<{ conversations: ConversationGroup[]; count: number }>(
      `/api/research/conversations?limit=${limit}`,
      { method: "GET" }
    );
  },
  async get(id: string) {
    return request<{ session: ResearchSession; report: { markdown: string } | null }>(
      `/api/research/sessions/${encodeURIComponent(id)}`,
      { method: "GET" }
    );
  },
  async remove(id: string) {
    return request<{ deleted: true; sessionId: string }>(`/api/research/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  },
  async clearAll() {
    return request<{ deleted: number; cleared: true }>("/api/research/sessions", { method: "DELETE" });
  }
};

/** src/server/routes/ask.js — POST /api/ask, the unified entry point (company chat / screener / macro). */
export const askApi = {
  async ask(body: Record<string, unknown>) {
    return request<ChatResult>("/api/ask", { method: "POST", body: JSON.stringify(body) });
  }
};

/** src/server/routes/reports.js — POST /api/report/generate (deep research). */
export const reportsApi = {
  async generate(body: Record<string, unknown>) {
    return request<ReportResult>("/api/report/generate", { method: "POST", body: JSON.stringify(body) });
  }
};

/** src/server/routes/documents.js — POST /api/parse-document (composer file upload). */
export const documentsApi = {
  async parse(body: { name?: string; type?: string; dataUrl: string; ticker?: string | null }) {
    return request<{ document: ParsedDocument }>("/api/parse-document", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }
};

/**
 * Streaming chat — mirrors src/ui/api.js's chatStream(): reads the /api/ask SSE
 * response (token/reasoning/final/error events), falling back to a plain JSON
 * POST if the endpoint doesn't stream or errors before a final event lands
 * (never silently drop the answer). Unlike the legacy version this takes
 * explicit callbacks instead of reaching into global UI state — the caller
 * (researchStore) decides what "foreground" means.
 */
export async function chatStream(
  body: Record<string, unknown>,
  callbacks: { onToken?: (text: string) => void; onReasoning?: (chars: number) => void } = {}
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
        } else if (evt === "final") {
          finalResult = json;
        } else if (evt === "error") {
          throw new Error(json.message || "流式作答失败");
        }
      }
    }
  } catch {
    if (!finalResult) finalResult = await request<ChatResult>("/api/ask", { method: "POST", body: JSON.stringify(body) });
  }
  return finalResult!;
}

export const feedbackApi = {
  async submit(message: string, context: Record<string, unknown> | null = null) {
    return request<{ id: number | string; received: true }>("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ message, context })
    });
  }
};
