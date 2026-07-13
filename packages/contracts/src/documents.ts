/**
 * Contract for src/server/routes/documents.js — only handleDocumentParseApi is wired in
 * server.js (POST /api/parse-document). handleDocumentList/Upload/Get/Delete are exported
 * but never mounted, so they're skipped here.
 *
 *   POST /api/parse-document { name?, type?, dataUrl, ticker? } → {document}
 */
import { z } from "zod";
import { okEnvelope } from "./envelope.js";

export const parseDocumentRequestSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  dataUrl: z.string(),
  ticker: z.string().optional()
});

/** Mirrors src/documentParser.js parseUploadedDocument() + the docId patched in by the route. */
export const parsedDocumentSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string(),
  type: z.string(),
  size: z.number(),
  parser: z.enum(["metadata", "pdf-lite", "text", "image-metadata"]),
  text: z.string(),
  summary: z.string(),
  createdAt: z.string()
});

export const parseDocumentResponseSchema = okEnvelope(z.object({ document: parsedDocumentSchema }));
