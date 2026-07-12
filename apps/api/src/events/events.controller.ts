import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { handleEventsDigest } from "../../../../src/server/routes/events.js";

@Controller()
export class EventsController {
  @Get("/api/events/digest")
  digest(@Req() req: Request, @Res() res: Response) {
    return handleEventsDigest(req as any, res as any);
  }
}
