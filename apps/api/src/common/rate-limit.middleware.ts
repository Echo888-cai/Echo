import { Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { rateLimitCheck } from "../../../../src/server/utils/httpGuard.js";
import { sendError } from "./http.js";

/**
 * Mirrors server.js lines ~76-78: every /api/* request is rate-limited before
 * anything else runs, using the existing token-bucket buckets/prefixes from
 * src/server/utils/httpGuard.js unchanged (general vs. heavy endpoints).
 */
@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const pathname = (req.path || req.url || "/").split("?")[0];
    const limited = rateLimitCheck(req, pathname);
    if (limited) {
      sendError(res, limited.status, limited.message);
      return;
    }
    next();
  }
}
