/**
 * Unified research entry contract — POST /api/ask.
 *
 * Unified entry point: server-side decides whether this is a company question
 * (delegates to chat's runChat — see chat.ts response shape / SSE) or a
 * screener/macro question (delegates to runDiscover — see discover.ts response shape).
 * Not enveloped (sendJson directly). No single fixed response schema exists for this
 * route since it fans out to two very different shapes depending on classification;
 * consumers should validate against chatResponseSchema OR the discover schemas.
 */
import { z } from "zod";
import { flatErrorSchema } from "./envelope.js";
import { parsedDocumentSchema } from "./documents.js";

export const askRequestSchema = z
  .object({
    question: z.string(),
    company: z.object({ ticker: z.string() }).catchall(z.unknown()).optional(),
    kind: z.enum(["company", "screener", "macro"]).optional(),
    compareWith: z.object({ ticker: z.string() }).catchall(z.unknown()).optional(),
    history: z.array(z.unknown()).optional(),
    /**
     * 用户上传并解析过的资料（parsedDocumentSchema 的形状）。
     *
     * 前端一直在发，但此前**没有出现在这份契约里**——它是靠下面的 `.catchall`
     * 混进来的，等于绕开了红线 9「端到端契约唯一」。既然它承载用户意图（用户上传了
     * 就期待它影响回答），就必须显式声明，并接受 check:dead-fields 门禁的检查：
     * 契约里有、消费方零读取的字段会直接失败。
     */
    documents: z.array(parsedDocumentSchema.partial().catchall(z.unknown())).optional(),
    sessionId: z.string().optional(),
    conversationId: z.string().optional()
  })
  .catchall(z.unknown());

export const askErrorResponseSchema = flatErrorSchema;
