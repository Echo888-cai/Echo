import { Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { handleReportGenerateApi } from "../../../../src/server/routes/reports.js";

/**
 * POST /api/report/generate — deep-research pipeline (data + web evidence + model
 * round-trip + factGuard + portrait write-back). Not SSE, but a large orchestration
 * that reads its body via readJsonBody; delegates straight to the existing handler
 * rather than re-deriving ~150 lines of pipeline glue.
 */
@Controller()
export class ReportsController {
  @Post("/api/report/generate")
  generate(@Req() req: Request, @Res() res: Response) {
    return handleReportGenerateApi(req as any, res as any);
  }
}
