import { Hono } from "hono";
import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import {
  companySearchResultSchema,
  companySearchResponseSchema,
  statusResponseSchema
} from "@echo/contracts";

// 迁移期只复用既有业务/仓储实现，不复刻规则。第二步完成后这些相对导入会被正式端口替代。
import { buildStatusSnapshot } from "../../../src/server/services/statusSnapshot.js";
import { searchCompanies } from "../../../src/server/repositories/companyRepository.js";
import { resolveRequestUser } from "../../../src/server/services/auth.js";
import { apiError, apiOk } from "../../../src/server/utils/async.js";

type User = { id: string; username: string; displayName: string; role: string };
type Context = { user: User | null };
type Variables = { user: User };

const t = initTRPC.context<Context>().create();
const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  return next({ ctx: { user: ctx.user } });
});

const searchInputSchema = z.object({ q: z.string().trim().max(120).default("") });
const searchOutputSchema = z.object({
  companies: z.array(companySearchResultSchema),
  total: z.number().int().nonnegative()
});

export const appRouter = t.router({
  status: protectedProcedure.output(statusResponseSchema).query(({ ctx }) => statusResponseSchema.parse(buildStatusSnapshot(ctx.user.id))),
  companies: t.router({
    search: protectedProcedure
      .input(searchInputSchema)
      .output(searchOutputSchema)
      .query(({ input }) => {
        const companies = input.q ? searchCompanies(input.q) : [];
        return { companies, total: companies.length };
      })
  })
});

export type AppRouter = typeof appRouter;

function requestUser(request: Request): User | null {
  const headers = Object.fromEntries(request.headers.entries());
  return resolveRequestUser({ headers });
}

export function createApp() {
  const app = new Hono<{ Variables: Variables }>();

  app.onError((error, c) => {
    console.error("[api]", error);
    return c.json(apiError(500, "服务暂时不可用"), 500);
  });

  app.get("/healthz", (c) => c.json({ ok: true, service: "echo-api" }));

  app.use("/api/*", async (c, next) => {
    const user = requestUser(c.req.raw);
    if (!user) return c.json(apiError(401, "请先登录"), 401);
    c.set("user", user);
    await next();
  });

  // REST/OpenAPI 兼容层与 tRPC 共用同一业务函数，迁移期不会出现第二套业务语义。
  app.get("/api/status", (c) => {
    const body = statusResponseSchema.parse(buildStatusSnapshot(c.get("user").id));
    return c.json(body);
  });

  app.get("/api/companies/search", (c) => {
    const input = searchInputSchema.parse({ q: c.req.query("q") || "" });
    const companies = input.q ? searchCompanies(input.q) : [];
    const body = companySearchResponseSchema.parse(apiOk({ companies, total: companies.length }));
    return c.json(body);
  });

  app.all("/trpc/*", (c) => fetchRequestHandler({
    endpoint: "/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({ user: requestUser(c.req.raw) })
  }));

  return app;
}

export const app = createApp();
