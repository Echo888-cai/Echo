import { Body, Controller, Get, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { handlePreferencesGet } from "../../../../src/server/routes/preferences.js";
import { updateUserPreferences } from "../../../../src/server/repositories/userPreferences.js";
import { insertFeedback } from "../../../../src/server/repositories/feedbackRepository.js";
import { preferencesUpdateRequestSchema, feedbackCreateRequestSchema } from "../../../../packages/contracts/src/index.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { sendOk, sendError, currentUserId } from "../common/http.js";

@Controller()
export class PreferencesController {
  @Get("/api/preferences")
  get(@Req() req: Request, @Res() res: Response) {
    return handlePreferencesGet(req as any, res as any);
  }

  @Patch("/api/preferences")
  async update(
    @Body(new ZodValidationPipe(preferencesUpdateRequestSchema)) body: any,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      sendOk(res as any, { preferences: updateUserPreferences(currentUserId(req), body) });
    } catch (error: any) {
      sendError(res as any, 400, error?.message || "保存偏好失败");
    }
  }

  @Post("/api/feedback")
  async feedback(
    @Body(new ZodValidationPipe(feedbackCreateRequestSchema)) body: any,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const message = String(body.message || "").trim();
      if (message.length < 2) {
        sendError(res as any, 400, "请至少写两个字");
        return;
      }
      const context = body.context && typeof body.context === "object" ? body.context : null;
      const id = insertFeedback(currentUserId(req), message, context);
      sendOk(res as any, { id, received: true });
    } catch (error: any) {
      sendError(res as any, 400, error?.message || "提交反馈失败");
    }
  }
}
