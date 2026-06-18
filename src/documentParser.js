import zlib from "node:zlib";

const MAX_TEXT_LENGTH = 12000;

function cleanText(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function decodePdfLiteral(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function decodeUtf16BeHex(hex) {
  const bytes = Buffer.from(hex, "hex");
  let output = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    output += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
  }
  return output;
}

function maybeInflate(buffer) {
  try {
    return zlib.inflateSync(buffer);
  } catch {
    return buffer;
  }
}

function extractPdfText(buffer) {
  const binary = buffer.toString("latin1");
  const streams = [...binary.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => Buffer.from(match[1], "latin1"));
  const sources = streams.length ? streams.map(maybeInflate) : [buffer];
  const chunks = [];

  for (const source of sources) {
    const text = source.toString("latin1");
    for (const match of text.matchAll(/\(([^()]{2,500})\)\s*Tj/g)) {
      chunks.push(decodePdfLiteral(match[1]));
    }
    for (const match of text.matchAll(/\[((?:.|\n){2,1200}?)\]\s*TJ/g)) {
      const items = [...match[1].matchAll(/\(([^()]{1,500})\)/g)].map((item) => decodePdfLiteral(item[1]));
      if (items.length) chunks.push(items.join(""));
    }
    for (const match of text.matchAll(/<([0-9A-Fa-f]{4,})>\s*Tj/g)) {
      try {
        chunks.push(decodeUtf16BeHex(match[1]));
      } catch {
        // Ignore malformed embedded strings.
      }
    }
  }

  return cleanText(chunks.join("\n"));
}

function parseDataUrl(dataUrl = "") {
  const match = String(dataUrl).match(/^data:([^;,]+)?(?:;[^,]+)?,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    buffer: Buffer.from(match[2], "base64")
  };
}

export function parseUploadedDocument({ name = "未命名文件", type = "", dataUrl = "" }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("文件内容格式无效");

  const mimeType = type || parsed.mimeType;
  const size = parsed.buffer.byteLength;
  const lowerName = String(name).toLowerCase();
  let text = "";
  let parser = "metadata";

  if (mimeType.includes("pdf") || lowerName.endsWith(".pdf")) {
    text = extractPdfText(parsed.buffer);
    parser = "pdf-lite";
  } else if (mimeType.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(lowerName)) {
    text = cleanText(parsed.buffer.toString("utf8"));
    parser = "text";
  } else if (mimeType.startsWith("image/")) {
    text = `图片资料：${name}\n类型：${mimeType}\n大小：${Math.round(size / 1024)} KB\n当前本地解析器已记录图片元数据；接入视觉 OCR 后可提取截图、公告图片或财报表格文字。`;
    parser = "image-metadata";
  }

  if (!text) {
    text = `资料：${name}\n类型：${mimeType || "未知"}\n大小：${Math.round(size / 1024)} KB\n未抽取到可读文本，请补充粘贴关键段落或改用可复制文字的 PDF。`;
  }

  return {
    id: `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    type: mimeType,
    size,
    parser,
    text,
    summary: cleanText(text).split("\n").slice(0, 4).join(" ").slice(0, 360),
    createdAt: new Date().toISOString()
  };
}
