import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  handleNotificationsList, handleNotificationsUnread, handleNotificationsTest, handleSchedulerStatus
} from "../../../../src/server/routes/notifications.js";
import { unreadCount, markRead, markAllRead } from "../../../../src/server/repositories/notifications.js";
import { notificationsReadRequestSchema } from "../../../../packages/contracts/src/index.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { sendOk, sendError, currentUserId } from "../common/http.js";

@Controller()
export class NotificationsController {
  @Get("/api/notifications/unread")
  unread(@Req() req: Request, @Res() res: Response) {
    return handleNotificationsUnread(req as any, res as any);
  }

  @Post("/api/notifications/read")
  read(
    @Body(new ZodValidationPipe(notificationsReadRequestSchema)) body: any,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const uid = currentUserId(req);
      if (body?.all) markAllRead(uid);
      else if (body?.id) markRead(body.id, uid);
      else {
        sendError(res as any, 400, "需要 {id} 或 {all:true}");
        return;
      }
      sendOk(res as any, { unread: unreadCount(uid) });
    } catch (error: any) {
      sendError(res as any, 500, error?.message || "标记已读失败");
    }
  }

  @Post("/api/notifications/test")
  test(@Req() req: Request, @Res() res: Response) {
    return handleNotificationsTest(req as any, res as any);
  }

  @Get("/api/notifications")
  list(@Req() req: Request, @Res() res: Response) {
    return handleNotificationsList(req as any, res as any);
  }

  @Get("/api/scheduler/status")
  schedulerStatus(@Req() req: Request, @Res() res: Response) {
    return handleSchedulerStatus(req as any, res as any);
  }
}
