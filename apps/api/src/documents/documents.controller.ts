import { Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { handleDocumentParseApi } from "../../../../src/server/routes/documents.js";

/**
 * POST /api/parse-document — only the parse-document handler is wired in server.js
 * (documents.js's CRUD handlers are exported but never mounted, so they're skipped
 * per the task brief). This route reads its body via readJsonBody (raw stream, up
 * to 8MB for base64 file payloads) inside the handler itself, so main.ts excludes
 * this path from Nest's global JSON body-parser to keep the stream intact.
 */
@Controller()
export class DocumentsController {
  @Post("/api/parse-document")
  parse(@Req() req: Request, @Res() res: Response) {
    return handleDocumentParseApi(req as any, res as any);
  }
}
