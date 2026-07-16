import { z } from "zod";

export const exportRequestSchema = z.object({
  sessionId: z.string().optional(),
  ticker: z.string().optional(),
  conversationId: z.string().optional(),
  format: z.enum(["markdown"]).default("markdown"),
  includeEvidence: z.boolean().optional(),
  includeTimeline: z.boolean().optional(),
  includeDisclaimer: z.boolean().optional()
});

export type ExportRequest = z.infer<typeof exportRequestSchema>;
