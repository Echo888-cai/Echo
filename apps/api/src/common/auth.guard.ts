import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { resolveRequestUser } from "../../../../src/server/services/authService.js";
import { enterRequestUser } from "../../../../src/server/services/requestContext.js";

/**
 * Mirrors server.js lines ~86-99:
 *   - /api/auth/* is always public (login/register/logout/invite/me handle their
 *     own auth internally — handleAuthInvite calls resolveRequestUser itself to
 *     check for an owner).
 *   - Everything else needs resolveRequestUser(req) to return a user, or 401.
 *     In "legacy owner" mode (ECHO_AUTH_DISABLED=1, or no users created yet)
 *     resolveRequestUser always resolves — so in practice almost nothing 401s
 *     until multi-user mode is actually turned on, exactly like today.
 * Attaches the resolved user to `request.echoUser` (same property name the
 * reused route/service code already expects) and threads it into the
 * AsyncLocalStorage-based request context via enterRequestUser, exactly as
 * server.js does, so any migrated service that calls currentUserId() internally
 * keeps working unchanged.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const pathname = (req.path || req.url || "/").split("?")[0];

    if (pathname.startsWith("/api/auth/")) {
      return true;
    }

    const user = resolveRequestUser(req as any);
    if (!user) {
      throw new UnauthorizedException("请先登录");
    }
    (req as any).echoUser = user;
    enterRequestUser(user.id);
    return true;
  }
}
