import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { sendError } from "./http.js";

/**
 * Mirrors server.js's U-1 CSRF gate exactly: every non-GET/HEAD request under
 * /api/* must carry `X-Echo-Auth: 1` (cross-site forms/images can't set custom
 * headers; our frontend fetch always sends it). Same status/message as the legacy
 * check so this is byte-identical behavior, not a reinterpretation.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const method = req.method || "GET";
    if (method !== "GET" && method !== "HEAD" && req.headers["x-echo-auth"] !== "1") {
      sendError(res, 403, "缺少校验请求头（请从 Echo Research 页面发起请求）");
      return;
    }
    next();
  }
}
