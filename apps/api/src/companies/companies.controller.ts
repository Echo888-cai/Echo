import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  handleCompanySearch, handleCompanyResolve, handleCompanyVerify
} from "../../../../src/server/routes/companies.js";

/** All 3 wired endpoints are pure GET/query — delegate straight to the existing handlers. */
@Controller()
export class CompaniesController {
  @Get("/api/companies/verify")
  verify(@Req() req: Request, @Res() res: Response) {
    return handleCompanyVerify(req as any, res as any);
  }

  @Get("/api/companies/resolve")
  resolve(@Req() req: Request, @Res() res: Response) {
    return handleCompanyResolve(req as any, res as any);
  }

  @Get("/api/companies/search")
  search(@Req() req: Request, @Res() res: Response) {
    return handleCompanySearch(req as any, res as any);
  }
}
