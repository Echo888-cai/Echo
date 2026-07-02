// ── 纯格式化工具（无依赖，被所有 UI 模块共享）──────────────

export function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function toast(message) {
  const toastNode = document.querySelector("#toast");
  if (!toastNode) return;
  toastNode.textContent = message;
  toastNode.classList.add("is-visible");
  clearTimeout(toastNode.timer);
  toastNode.timer = setTimeout(() => toastNode.classList.remove("is-visible"), 2200);
}

export function hostFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// 市场标签：港股（数字/.HK）/ 美股（其余）。代码缺省返回空串。
export function marketLabelOf(ticker = "") {
  if (!ticker) return "";
  return /\.HK$|^\d/.test(ticker) ? "港股" : "美股";
}

// SQLite datetime('now') 是 UTC，转相对时间显示。
export function notifWhen(createdAt = "") {
  const t = Date.parse(String(createdAt).replace(" ", "T") + (createdAt.includes("Z") || createdAt.includes("+") ? "" : "Z"));
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// changePct 已是百分数（如 -3.1），不再 ×100；returnPct 是小数，走 fmtPct。
export function wdChg(p) {
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  const dir = p > 0 ? "is-up" : p < 0 ? "is-down" : "is-flat";
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  return { text: `${sign}${Math.abs(p).toFixed(1)}%`, dir };
}

export function wdWhen(date) {
  const s = String(date || "");
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "今天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function fmtPct(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

export function fmtNum(v, digits = 2) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

export function pnlDir(v) {
  return typeof v === "number" && Number.isFinite(v) ? (v > 0 ? "is-up" : v < 0 ? "is-down" : "is-flat") : "is-flat";
}

// null/"" 经 Number() 会变成 0（finite），不能直接用 Number.isFinite 判存在性——isNum 显式挡掉空值，
// 否则缺失的目标价/盈亏会渲染成误导的 "0.00 / +0.0%"。
export const isNum = (v) => v != null && v !== "" && Number.isFinite(Number(v));
export const fmtMoney = (v) => (isNum(v) ? (Math.abs(Number(v)) >= 100 ? Number(v).toFixed(0) : Number(v).toFixed(2)) : "—");
export const fmtSigned = (v) => (isNum(v) ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%` : null);
export const dirClass = (v) => (Number(v) > 0 ? "up" : Number(v) < 0 ? "down" : "flat");

export function numFrom(value) {
  const n = parseFloat(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function credLevel(score) {
  if (typeof score !== "number") return "mid";
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "mid";
  return "low";
}
