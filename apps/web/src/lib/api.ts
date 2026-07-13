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
  type tickerScorecardSchema
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

export const feedbackApi = {
  async submit(message: string, context: Record<string, unknown> | null = null) {
    return request<{ id: number | string; received: true }>("/api/feedback", {
      method: "POST",
      body: JSON.stringify({ message, context })
    });
  }
};
