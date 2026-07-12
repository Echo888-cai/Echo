import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { Response } from "express";
import { apiError } from "./http.js";

/**
 * Maps any thrown exception (BadRequestException from ZodValidationPipe,
 * UnauthorizedException from AuthGuard, or an unexpected error) onto the exact
 * {ok:false, error:{code,message,details?}, meta:{requestId}} envelope that
 * src/server/utils/async.js's sendError() writes today, so the wire format stays
 * identical to the legacy server.js regardless of where in the Nest pipeline the
 * failure occurred.
 */
@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = 500;
    let message = "服务器内部错误";
    let details: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        message = typeof b.message === "string" ? b.message : exception.message;
        if (Array.isArray(b.issues)) details = b.issues;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message || message;
    }

    const payload = apiError(status, message, details);
    res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(payload);
  }
}
