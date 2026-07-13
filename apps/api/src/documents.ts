import { addDocument } from "@echo/db/repositories/documentRepository.js";

export async function parseDocument(input: { name?: string; type?: string; dataUrl: string; ticker?: string }, userId: string) {
  const match = input.dataUrl.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
  if (!match) throw new Error("文件格式无效");
  const mime = input.type || match[1] || "application/octet-stream";
  const encoded = match[2] || "";
  const buffer = input.dataUrl.includes(";base64,") ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded));
  if (buffer.length > 8_000_000) throw new Error("文件不能超过 8MB");
  const isText = mime.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(input.name || "");
  const text = isText ? buffer.toString("utf8").slice(0, 300_000) : "";
  const parser = isText ? "text" as const : mime === "application/pdf" ? "pdf-lite" as const : mime.startsWith("image/") ? "image-metadata" as const : "metadata" as const;
  const name = input.name || "上传文件";
  const createdAt = new Date().toISOString();
  const summary = text ? text.replace(/\s+/g, " ").slice(0, 240) : `${name}（${mime}，${buffer.length} bytes）`;
  const id = await addDocument({ userId, ticker: input.ticker, name, mimeType: mime, size: buffer.length, parser, text, summary, sourceType: "upload" });
  return { id, name, type: mime, size: buffer.length, parser, text, summary, createdAt };
}
