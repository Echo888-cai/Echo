// React port of src/ui/watch.js's exportPortraitImage() — draws the portrait
// share card with the native Canvas API (no screenshot lib, no upload of the
// user's research data). Kept as a standalone module since it's pure canvas
// drawing with no React/DOM-query dependency, unlike the rest of watch.js.
const SHARE_FONT = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif";
const SHARE_COLORS = {
  bg: "#f0eee6",
  panel: "#fcfbf8",
  ink: "#141413",
  ink2: "#3d3b35",
  muted: "#82807a",
  accent: "#bf5c3e",
  line: "rgba(31,30,24,0.14)"
};

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const chars = Array.from(String(text || ""));
  let line = "";
  let curY = y;
  for (const ch of chars) {
    const next = line + ch;
    if (line && ctx.measureText(next).width > maxWidth) {
      ctx.fillText(line, x, curY);
      line = ch;
      curY += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) {
    ctx.fillText(line, x, curY);
    curY += lineHeight;
  }
  return curY;
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  if (typeof (ctx as any).roundRect === "function") {
    (ctx as any).roundRect(x, y, width, height, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
  }
  ctx.closePath();
}

const RS_LABEL: Record<string, string> = {
  watch: "持续观察",
  research_more: "需要补充材料",
  data_missing: "数据缺失",
  risk_alert: "风险提示",
  out_of_scope: "不在范围"
};

function fmtNum(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "—";
}

export function exportPortraitImage(profile: any, onToast: (msg: string) => void) {
  if (!profile) {
    onToast("画像还没加载好。");
    return;
  }

  const W = 1080;
  const H = 1350;
  const pad = 64;
  const inner = pad + 56;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    onToast("当前浏览器不支持生成分享图。");
    return;
  }
  const C = SHARE_COLORS;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  drawRoundedRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 28);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  let y = inner + 20;
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(inner + 14, y - 8, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.muted;
  ctx.font = `600 26px ${SHARE_FONT}`;
  ctx.fillText("ECHO RESEARCH", inner + 40, y);

  y += 76;
  ctx.fillStyle = C.ink;
  ctx.font = `700 64px ${SHARE_FONT}`;
  ctx.fillText(String(profile.companyName || profile.ticker || "").slice(0, 12), inner, y);

  y += 48;
  ctx.fillStyle = C.muted;
  ctx.font = `400 30px ${SHARE_FONT}`;
  ctx.fillText(String(profile.ticker || ""), inner, y);

  y += 56;
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(inner, y);
  ctx.lineTo(W - inner, y);
  ctx.stroke();

  y += 64;
  ctx.fillStyle = C.muted;
  ctx.font = `600 24px ${SHARE_FONT}`;
  ctx.fillText("投资主线", inner, y);

  y += 48;
  ctx.fillStyle = C.ink2;
  ctx.font = `400 40px ${SHARE_FONT}`;
  const thesis = String(profile.thesis || "还没有沉淀投资主线，完成一轮研究后自动生成。").slice(0, 160);
  y = wrapCanvasText(ctx, thesis, inner, y, W - inner * 2, 56);

  const bull: string[] = Array.isArray(profile.bull) ? profile.bull.slice(0, 2) : [];
  if (bull.length) {
    y += 24;
    ctx.fillStyle = C.muted;
    ctx.font = `600 24px ${SHARE_FONT}`;
    ctx.fillText("看多要点", inner, y);
    y += 44;
    ctx.font = `400 32px ${SHARE_FONT}`;
    ctx.fillStyle = C.ink2;
    for (const point of bull) {
      y = wrapCanvasText(ctx, `· ${String(point).slice(0, 60)}`, inner, y, W - inner * 2, 44);
      y += 8;
    }
  }

  const valuation = profile.valuation;
  const valuationNumbers = valuation ? [valuation.bear, valuation.base, valuation.bull].map(Number) : [];
  if (valuation && valuationNumbers.every((value) => Number.isFinite(value))) {
    y += 32;
    ctx.fillStyle = C.muted;
    ctx.font = `600 24px ${SHARE_FONT}`;
    ctx.fillText("估值区间（熊 / 中枢 / 牛）", inner, y);
    y += 48;
    ctx.fillStyle = C.ink;
    ctx.font = `700 36px ${SHARE_FONT}`;
    ctx.fillText(`${fmtNum(valuationNumbers[0])}  /  ${fmtNum(valuationNumbers[1])}  /  ${fmtNum(valuationNumbers[2])}`, inner, y);
  }

  const footY = H - pad - 56;
  ctx.fillStyle = C.muted;
  ctx.font = `400 26px ${SHARE_FONT}`;
  const tags: string[] = [];
  if (profile.researchStatus) tags.push(RS_LABEL[profile.researchStatus] || profile.researchStatus);
  if (profile.confidence) tags.push(`置信度 · ${profile.confidence}`);
  if (profile.turnCount) tags.push(`已研究 ${profile.turnCount} 轮`);
  ctx.fillText(tags.join("　·　"), inner, footY);

  ctx.fillStyle = C.accent;
  ctx.font = `italic 400 26px ${SHARE_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText("喧声之外，见真知", W - inner, footY);
  ctx.textAlign = "left";

  canvas.toBlob((blob) => {
    if (!blob) {
      onToast("生成分享图失败。");
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${String(profile.ticker || "echo").replace(/[^\w.-]/g, "")}-share.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    onToast("已导出分享图。");
  }, "image/png");
}
