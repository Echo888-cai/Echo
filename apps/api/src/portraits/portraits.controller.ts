import { Controller, Get, Delete, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  handleProfileList, handleProfileGet, handleProfileDelete, handleProfileReview, handleResearchScorecard
} from "../../../../src/server/routes/portraits.js";

/** All 5 wired endpoints are pure GET/DELETE-by-query — delegate straight through. */
@Controller()
export class PortraitsController {
  @Get("/api/company/profiles")
  list(@Req() req: Request, @Res() res: Response) {
    return handleProfileList(req as any, res as any);
  }

  @Get("/api/company/review")
  review(@Req() req: Request, @Res() res: Response) {
    return handleProfileReview(req as any, res as any);
  }

  @Get("/api/company/profile")
  get(@Req() req: Request, @Res() res: Response) {
    return handleProfileGet(req as any, res as any);
  }

  @Delete("/api/company/profile")
  delete(@Req() req: Request, @Res() res: Response) {
    return handleProfileDelete(req as any, res as any);
  }

  @Get("/api/research/scorecard")
  scorecard(@Req() req: Request, @Res() res: Response) {
    return handleResearchScorecard(req as any, res as any);
  }
}
