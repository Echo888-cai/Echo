import { Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { handleAskApi } from "../../../../src/server/routes/ask.js";

/**
 * POST /api/ask — unified entry point; may respond as plain JSON (screener/macro)
 * or as an SSE stream (company research via chatOrchestrator.runChat). The handler
 * reads its body via readJsonBody(req) on the raw stream and writes either a JSON
 * body or manual `res.write` SSE chunks itself — replicating that byte-for-byte in
 * a rewritten controller would mean re-deriving the entire streaming contract, so
 * this delegates straight to the existing handler instead (raw @Res(), no Nest
 * return-value serialization). main.ts excludes this path from the global JSON
 * body-parser so the stream stays intact for readJsonBody.
 */
@Controller()
export class AskController {
  @Post("/api/ask")
  ask(@Req() req: Request, @Res() res: Response) {
    return handleAskApi(req as any, res as any);
  }
}
