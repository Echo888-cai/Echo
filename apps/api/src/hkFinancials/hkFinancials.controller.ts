import { Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  handleHkFinancialsList, handleHkFinancialsIngest
} from "../../../../src/server/routes/hkFinancials.js";

/** Both endpoints read only query params (no JSON body) — delegate straight through. */
@Controller()
export class HkFinancialsController {
  @Post("/api/hk-financials/ingest")
  ingest(@Req() req: Request, @Res() res: Response) {
    return handleHkFinancialsIngest(req as any, res as any);
  }

  @Get("/api/hk-financials")
  list(@Req() req: Request, @Res() res: Response) {
    return handleHkFinancialsList(req as any, res as any);
  }
}
