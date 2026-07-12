import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module.js";

/**
 * Endpoints whose route handlers read the request body themselves via
 * readJsonBody(req) on the raw stream (some support up to 8MB payloads, one is
 * SSE). Nest's global JSON body-parser must NOT touch these paths or the stream
 * will already be drained by the time the handler tries to read it.
 */
const RAW_BODY_PATHS = new Set([
  "/api/ask",
  "/api/chat",
  "/api/discover",
  "/api/report/generate",
  "/api/parse-document"
]);

async function bootstrap() {
  // bodyParser:false — we install our own conditional JSON parser below so the
  // 5 raw-body endpoints above keep an untouched stream for readJsonBody.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const jsonParser = json({ limit: "10mb" });
  app.use((req: Request, res: Response, next: NextFunction) => {
    const pathname = (req.originalUrl || req.url || "/").split("?")[0];
    if (RAW_BODY_PATHS.has(pathname)) return next();
    return jsonParser(req, res, next);
  });

  const port = Number(process.env.API_PORT || 4000);
  await app.listen(port, "127.0.0.1");
  // eslint-disable-next-line no-console
  console.log(`Echo Research API (NestJS) is running at http://127.0.0.1:${port}`);
}

bootstrap();
