import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { handleStatusApi } from "../../../../src/server/routes/status.js";

/**
 * GET /api/status — delegates straight to the existing handler. It only reads
 * req.echoUser (already attached by AuthGuard) and writes via sendJson, so there is
 * nothing to reimplement: the whole "controller" is routing.
 */
@Controller()
export class StatusController {
  @Get("/api/status")
  status(@Req() req: Request, @Res() res: Response) {
    return handleStatusApi(req as any, res as any);
  }
}
