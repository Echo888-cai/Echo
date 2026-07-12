import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodTypeAny } from "zod";

/**
 * Generic zod PipeTransform — validates whatever value Nest hands it (body, query,
 * or a single param) against the given schema from @echo/contracts. On failure it
 * throws BadRequestException with the zod error; our global EnvelopeExceptionFilter
 * (see exception.filter.ts) turns that into the same {ok:false,error:{code,message}}
 * shape src/server/utils/async.js's sendError() produces, so callers can't tell
 * whether a 400 came from the old server.js or this app.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new BadRequestException({
        message: "请求参数校验失败",
        issues: result.error.issues
      });
    }
    return result.data;
  }
}

/** Convenience factory so controllers can write `new ZodPipe(someSchema)`. */
export function ZodPipe(schema: ZodTypeAny) {
  return new ZodValidationPipe(schema);
}
