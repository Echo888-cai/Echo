/**
 * Thin re-export of the existing response-envelope helpers so controllers reuse the
 * exact same wire format the legacy server.js produces (see
 * src/server/utils/async.js). We do NOT reimplement sendOk/sendError/sendJson here —
 * only forward them, per the R-2 strangler rule (domain/utility code moves, not rewrites).
 */
import {
  readJsonBody as readJsonBodyImpl,
  sendOk as sendOkImpl,
  sendError as sendErrorImpl,
  sendJson as sendJsonImpl,
  apiError as apiErrorImpl,
  apiOk as apiOkImpl,
  withTimeout as withTimeoutImpl
} from "../../../../src/server/utils/async.js";

export const readJsonBody = readJsonBodyImpl;
export const sendOk = sendOkImpl;
export const sendError = sendErrorImpl;
export const sendJson = sendJsonImpl;
export const apiError = apiErrorImpl;
export const apiOk = apiOkImpl;
export const withTimeout = withTimeoutImpl;

/** Same resolution rule every route.js file uses: req.echoUser?.id || "local". */
export function currentUserId(req: any): string {
  return req.echoUser?.id || "local";
}
