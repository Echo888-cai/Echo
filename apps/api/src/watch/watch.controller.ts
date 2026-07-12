import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { handleWatchDesk, handleWatchStock } from "../../../../src/server/routes/watch.js";
import { addToWatch, removeFromWatch } from "../../../../src/server/repositories/watchlist.js";
import { watchTrackRequestSchema, watchUntrackRequestSchema } from "../../../../packages/contracts/src/index.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { sendOk, sendError, currentUserId } from "../common/http.js";

@Controller()
export class WatchController {
  @Get("/api/watch/stock")
  stock(@Req() req: Request, @Res() res: Response) {
    return handleWatchStock(req as any, res as any);
  }

  @Get("/api/watch/desk")
  desk(@Req() req: Request, @Res() res: Response) {
    return handleWatchDesk(req as any, res as any);
  }

  @Post("/api/watch/track")
  track(
    @Body(new ZodValidationPipe(watchTrackRequestSchema)) body: any,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const ticker = (body.ticker || "").trim();
      if (!ticker) {
        sendError(res as any, 400, "缺少 ticker");
        return;
      }
      addToWatch(ticker, body.name, currentUserId(req));
      sendOk(res as any, { tracked: true, ticker });
    } catch (error: any) {
      sendError(res as any, 500, error?.message || "添加关注失败");
    }
  }

  @Post("/api/watch/untrack")
  untrack(
    @Body(new ZodValidationPipe(watchUntrackRequestSchema)) body: any,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const ticker = (body.ticker || "").trim();
      if (!ticker) {
        sendError(res as any, 400, "缺少 ticker");
        return;
      }
      removeFromWatch(ticker, currentUserId(req));
      sendOk(res as any, { untracked: true, ticker });
    } catch (error: any) {
      sendError(res as any, 500, error?.message || "移除关注失败");
    }
  }
}
