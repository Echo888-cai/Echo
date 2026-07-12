import { Controller, Delete, Get, Param, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  handleSessionList, handleConversationList, handleSessionClear, handleSessionGet, handleSessionDelete
} from "../../../../src/server/routes/research.js";

/**
 * research.js's handlers already accept the extracted `id` as a 3rd argument
 * (server.js does the `/api/research/sessions/:id` regex extraction itself) —
 * Nest's @Param('id') replicates that extraction, so we pass it straight through.
 */
@Controller()
export class ResearchController {
  @Get("/api/research/conversations")
  conversations(@Req() req: Request, @Res() res: Response) {
    return handleConversationList(req as any, res as any);
  }

  @Get("/api/research/sessions")
  list(@Req() req: Request, @Res() res: Response) {
    return handleSessionList(req as any, res as any);
  }

  @Delete("/api/research/sessions")
  clear(@Req() req: Request, @Res() res: Response) {
    return handleSessionClear(req as any, res as any);
  }

  @Get("/api/research/sessions/:id")
  get(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    return handleSessionGet(req as any, res as any, id);
  }

  @Delete("/api/research/sessions/:id")
  delete(@Param("id") id: string, @Req() req: Request, @Res() res: Response) {
    return handleSessionDelete(req as any, res as any, id);
  }
}
