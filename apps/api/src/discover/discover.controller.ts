import { Controller, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { handleDiscoverApi } from "../../../../src/server/routes/discover.js";

/** POST /api/discover — plain JSON (not SSE), but still reads its body via readJsonBody. */
@Controller()
export class DiscoverController {
  @Post("/api/discover")
  discover(@Req() req: Request, @Res() res: Response) {
    return handleDiscoverApi(req as any, res as any);
  }
}
