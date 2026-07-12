import { Body, Controller, Post, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { handleAuthLogout, handleAuthMe } from "../../../../src/server/routes/auth.js";
import {
  loginWithPassword, registerWithInvite, resolveRequestUser, multiUserEnabled, sessionCookie
} from "../../../../src/server/services/authService.js";
import { createInvite } from "../../../../src/server/repositories/authRepository.js";
import {
  authLoginRequestSchema, authRegisterRequestSchema, authInviteRequestSchema
} from "../../../../packages/contracts/src/index.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { sendOk, sendError } from "../common/http.js";

@Controller()
export class AuthController {
  @Post("/api/auth/login")
  login(@Body(new ZodValidationPipe(authLoginRequestSchema)) body: any, @Res() res: Response) {
    try {
      const { user, token } = loginWithPassword({ username: body.username, password: body.password });
      res.setHeader("Set-Cookie", sessionCookie(token));
      sendOk(res as any, { user });
    } catch (error: any) {
      sendError(res as any, 401, error?.message || "登录失败");
    }
  }

  @Post("/api/auth/register")
  register(@Body(new ZodValidationPipe(authRegisterRequestSchema)) body: any, @Res() res: Response) {
    try {
      const { user, token } = registerWithInvite({
        invite: body.invite, username: body.username, password: body.password, displayName: body.displayName
      });
      res.setHeader("Set-Cookie", sessionCookie(token));
      sendOk(res as any, { user });
    } catch (error: any) {
      sendError(res as any, 400, error?.message || "注册失败");
    }
  }

  @Post("/api/auth/logout")
  logout(@Req() req: Request, @Res() res: Response) {
    return handleAuthLogout(req as any, res as any);
  }

  @Get("/api/auth/me")
  me(@Req() req: Request, @Res() res: Response) {
    return handleAuthMe(req as any, res as any);
  }

  @Post("/api/auth/invite")
  invite(
    @Body(new ZodValidationPipe(authInviteRequestSchema)) body: any,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      if (!multiUserEnabled()) {
        sendError(res as any, 409, "请先用管理命令创建 owner 账号");
        return;
      }
      const user = resolveRequestUser(req as any);
      if (!user || user.role !== "owner") {
        sendError(res as any, 403, "只有 owner 能生成邀请码");
        return;
      }
      const code = `echo-${randomBytes(4).toString("hex")}`;
      createInvite(code, { note: body.note, createdBy: user.id });
      sendOk(res as any, { code });
    } catch (error: any) {
      sendError(res as any, 500, error?.message || "生成邀请码失败");
    }
  }
}
