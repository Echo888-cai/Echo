import { Body, Controller, Delete, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  handlePortfolioList, handlePortfolioReview, handlePortfolioSnapshots, handlePortfolioDelete
} from "../../../../src/server/routes/portfolio.js";
import { upsertPosition } from "../../../../src/server/repositories/portfolio.js";
import { enrichPosition } from "../../../../src/server/services/portfolioEnrich.js";
import { portfolioUpsertRequestSchema } from "../../../../packages/contracts/src/index.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { sendOk, sendError, currentUserId } from "../common/http.js";

const toNum = (v: unknown) => {
  if (v === "" || v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

@Controller()
export class PortfolioController {
  @Get("/api/portfolio/review")
  review(@Req() req: Request, @Res() res: Response) {
    return handlePortfolioReview(req as any, res as any);
  }

  @Get("/api/portfolio/snapshots")
  snapshots(@Req() req: Request, @Res() res: Response) {
    return handlePortfolioSnapshots(req as any, res as any);
  }

  @Get("/api/portfolio")
  list(@Req() req: Request, @Res() res: Response) {
    return handlePortfolioList(req as any, res as any);
  }

  @Post("/api/portfolio")
  async upsert(
    @Body(new ZodValidationPipe(portfolioUpsertRequestSchema)) body: any,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const ticker = (body.ticker || "").trim();
      if (!ticker) {
        sendError(res as any, 400, "缺少 ticker");
        return;
      }
      const uid = currentUserId(req);
      const position = upsertPosition(ticker, {
        companyName: body.companyName,
        shares: toNum(body.shares),
        avgCost: toNum(body.avgCost),
        stopLoss: toNum(body.stopLoss),
        takeProfit: toNum(body.takeProfit),
        note: body.note
      }, uid);
      sendOk(res as any, { position: await enrichPosition(position, uid) });
    } catch (error: any) {
      sendError(res as any, 500, error?.message || "保存持仓失败");
    }
  }

  @Delete("/api/portfolio")
  delete(@Req() req: Request, @Res() res: Response) {
    return handlePortfolioDelete(req as any, res as any);
  }
}
