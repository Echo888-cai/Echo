import { Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { handleChatApi } from "../../../../src/server/routes/chat.js";

/**
 * POST /api/chat — same SSE/streaming situation as /api/ask (see ask.controller.ts):
 * delegates straight to the existing handler with the raw body stream intact.
 */
@Controller()
export class ChatController {
  @Post("/api/chat")
  chat(@Req() req: Request, @Res() res: Response) {
    return handleChatApi(req as any, res as any);
  }
}
