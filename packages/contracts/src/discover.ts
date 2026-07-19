/**
 * Discovery contract — POST /api/discover.
 */
import { z } from "zod";

export const discoverRequestSchema = z.object({
  question: z.string(),
  kind: z.enum(["screener", "macro"]).optional()
});

/** runAsk 的 screener 分支返回值。 */
export const screenerResponseSchema = z.object({
  kind: z.literal("screener"),
  filters: z.record(z.string(), z.unknown()),
  rows: z.array(z.record(z.string(), z.unknown())),
  /** 条件筛选尚未接通：空 rows **不代表**"没有符合条件的公司"，前端必须据此区分
   *  "筛过了没结果" 与 "根本没筛"——两者对用户的含义完全相反。 */
  unavailable: z.boolean().optional(),
  notes: z.array(z.string()).optional()
});

/** services/discovery.js runMacro() return value. */
export const macroResponseSchema = z.object({
  kind: z.literal("macro"),
  content: z.string(),
  mode: z.enum(["model", "local_fallback"]),
  indices: z.array(z.unknown()),
  evidence: z.array(
    z.object({
      title: z.string().optional(),
      url: z.string().optional(),
      source: z.string().optional(),
      type: z.string(),
      cred: z.number().nullable(),
      date: z.string()
    })
  ),
  gaps: z.array(z.unknown())
});

export const discoverResponseSchema = z.union([screenerResponseSchema, macroResponseSchema]);

export const discoverErrorResponseSchema = z.object({ error: z.string() });
