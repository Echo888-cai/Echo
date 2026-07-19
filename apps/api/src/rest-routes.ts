import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { apiError, apiOk } from "./http.js";
import { runAsk } from "@echo/application/research";
import { listResearchSessions } from "@echo/db/repositories/researchSessionsRepository.js";
import { deleteCompanyProfile, listCompanyProfiles } from "@echo/db/repositories/companyProfilesRepository.js";
import { getHkFinancials } from "@echo/db/repositories/hkFinancialsRepository.js";
import { executeFilingWorkflow } from "./temporal.js";

type CallerFactory = (c: any, responseHeaders: Headers) => Promise<any>;

function responseWithHeaders(response: Response, additions: Headers) {
  const headers = new Headers(response.headers);
  additions.forEach((value, key) => headers.append(key, value));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function registerRestRoutes(app: Hono<any>, createCaller: CallerFactory) {
  const route = (select: (caller: any, c: any) => Promise<unknown> | unknown, { flat = false } = {}) => async (c: any) => {
    const headers = new Headers();
    const caller = await createCaller(c, headers);
    const data = await select(caller, c);
    return responseWithHeaders(c.json(flat ? data : apiOk(data)), headers);
  };

  app.post("/api/auth/login", route((caller, c) => c.req.json().then((body: unknown) => caller.auth.login(body))));
  app.post("/api/auth/register", route((caller, c) => c.req.json().then((body: unknown) => caller.auth.register(body))));
  app.post("/api/auth/logout", route((caller) => caller.auth.logout()));
  app.get("/api/auth/me", route((caller) => caller.auth.me()));
  app.post("/api/auth/invite", route((caller, c) => c.req.json().then((body: unknown) => caller.auth.invite(body))));

  app.get("/api/companies/verify", route((caller, c) => caller.companies.verify({ ticker: c.req.query("ticker") || "" })));
  app.get("/api/companies/resolve", route((caller, c) => caller.companies.resolve({ q: c.req.query("q") || "" })));
  app.get("/api/preferences", route((caller) => caller.preferences.get()));
  app.patch("/api/preferences", route((caller, c) => c.req.json().then((body: unknown) => caller.preferences.update(body))));
  app.post("/api/feedback", route((caller, c) => c.req.json().then((body: unknown) => caller.feedback.submit(body))));
  app.post("/api/parse-document", route((caller, c) => c.req.json().then((body: unknown) => caller.documents.parse(body))));

  app.post("/api/ask", async (c: any) => {
    const input = await c.req.json();
    const userId = c.get("user").id;
    if (input.stream !== true) return c.json(await runAsk(input, userId));
    return streamSSE(c, async (stream) => {
      try {
        // Real token streaming: modelAnswer forwards each provider delta here as it
        // arrives, so first-token latency is the provider's, not "wait for the whole
        // answer then replay it fast" — the previous behavior gave zero streaming
        // benefit since it only started once generation was already complete.
        // Stage events mirror runResearch's actual pipeline steps (resolving/
        // market_financials/valuation/generating/fact_check) so the frontend wait
        // indicator reflects real progress instead of a fixed clock-driven carousel.
        const result: any = await runAsk(
          input,
          userId,
          (delta) => stream.writeSSE({ event: "token", data: JSON.stringify({ t: delta }) }),
          (stage, plan) => stream.writeSSE({ event: "status", data: JSON.stringify({ stage, ...(plan ? { plan } : {}) }) })
        );
        await stream.writeSSE({ event: "final", data: JSON.stringify(result) });
        await stream.writeSSE({ event: "done", data: "{}" });
      } catch (error) {
        await stream.writeSSE({ event: "error", data: JSON.stringify({ message: error instanceof Error ? error.message : "研究失败" }) });
      }
    }, async (error) => { console.error("[sse]", error); });
  });
  app.post("/api/chat", async (c: any) => c.json(await runAsk(await c.req.json(), c.get("user").id)));
  app.post("/api/discover", async (c: any) => {
    const input = await c.req.json();
    return c.json(await runAsk({ ...input, kind: input.kind || "screener" }, c.get("user").id));
  });
  app.post("/api/report/generate", route((caller, c) => c.req.json().then((body: unknown) => caller.reports.generate(body)), { flat: true }));

  app.get("/api/notifications/unread", route((caller) => caller.notifications.unread()));
  app.post("/api/notifications/read", route((caller, c) => c.req.json().then((body: unknown) => caller.notifications.read(body))));
  app.post("/api/notifications/test", route((caller) => caller.notifications.test()));
  app.get("/api/notifications", route((caller, c) => caller.notifications.list({ limit: Number(c.req.query("limit") || 20) })));
  app.get("/api/scheduler/status", route((caller) => caller.scheduler.status()));

  app.get("/api/watch/stock", route((caller, c) => caller.watch.stock({ ticker: c.req.query("ticker") || "" })));
  app.get("/api/watch/desk", route((caller, c) => caller.watch.desk({ events: c.req.query("events") !== "0" })));
  app.post("/api/watch/track", route((caller, c) => c.req.json().then((body: unknown) => caller.watch.track(body))));
  app.post("/api/watch/untrack", route((caller, c) => c.req.json().then((body: unknown) => caller.watch.untrack(body))));
  app.get("/api/events/digest", route((caller) => caller.watch.desk({ events: true })));

  app.get("/api/portfolio/review", route((caller) => caller.portfolio.review()));
  app.get("/api/portfolio/snapshots", route((caller) => caller.portfolio.snapshots()));
  app.get("/api/portfolio", route((caller) => caller.portfolio.list()));
  app.post("/api/portfolio", route((caller, c) => c.req.json().then((body: unknown) => caller.portfolio.upsert(body))));
  app.delete("/api/portfolio", route((caller, c) => caller.portfolio.remove({ ticker: c.req.query("ticker") || "" })));

  app.get("/api/company/profiles", async (c: any) => {
    const profiles = await listCompanyProfiles(Math.min(100, Number(c.req.query("limit") || 50)), c.get("user").id);
    return c.json(apiOk({ profiles, count: profiles.length }));
  });
  app.get("/api/company/review", route((caller, c) => caller.portraits.review({ ticker: c.req.query("ticker") || "" })));
  app.get("/api/company/profile", route((caller, c) => caller.portraits.profile({ ticker: c.req.query("ticker") || "" })));
  app.delete("/api/company/profile", async (c: any) => {
    const ticker = c.req.query("ticker") || "";
    const deleted = await deleteCompanyProfile(ticker, c.get("user").id);
    return c.json(apiOk({ deleted, ticker }));
  });
  app.get("/api/research/scorecard", route((caller) => caller.research.scorecard()));
  app.get("/api/research/conversations", route((caller, c) => caller.research.conversations({ limit: Number(c.req.query("limit") || 20) })));
  app.get("/api/research/sessions", async (c: any) => {
    const sessions = await listResearchSessions({ ticker: c.req.query("ticker"), limit: Math.min(50, Number(c.req.query("limit") || 20)), userId: c.get("user").id });
    const mapped = sessions.map((session) => ({ ...session, title: session.title || session.question || session.company_name || session.ticker,
      preview: session.question ? String(session.question).slice(0, 120) : "", companyName: session.company_name || session.ticker, turnCount: session.turn_count || 0 }));
    return c.json(apiOk({ sessions: mapped, count: mapped.length }));
  });
  app.delete("/api/research/sessions", route((caller) => caller.research.clear()));
  app.get("/api/research/sessions/:id", route((caller, c) => caller.research.get({ id: c.req.param("id") })));
  app.delete("/api/research/sessions/:id", route((caller, c) => caller.research.remove({ id: c.req.param("id") })));

  app.get("/api/hk-financials", async (c: any) => {
    const ticker = c.req.query("ticker") || "";
    return c.json(apiOk({ ticker, rows: await getHkFinancials(ticker, Number(c.req.query("limit") || 4)) }));
  });
  app.post("/api/hk-financials/ingest", async (c: any) => {
    const ticker = c.req.query("ticker") || "";
    try {
      const result = await executeFilingWorkflow({ market: "HK", ticker, limit: Number(c.req.query("limit") || 4), force: c.req.query("force") === "1" });
      return c.json(apiOk(result));
    } catch (error) {
      console.error("[hk-financials/ingest] Temporal 不可达", error instanceof Error ? error.message : error);
      return c.json(apiError(503, "Filing 工作流依赖 Temporal，当前本地未连接 Temporal server，请先启动（见 docs/architecture）后重试。"), 503);
    }
  });
}
