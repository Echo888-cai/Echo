// Shared formatting helpers ported from src/ui/format.js. React auto-escapes
// interpolated text, so esc() itself is not needed here — only the pure
// date/number helpers actually used by the migrated components.

// returnPct is a decimal (0.031 -> "+3.1%"); changePct fields elsewhere are
// already percentages and don't go through this helper (mirrors format.js).
export function fmtPct(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

export function pnlDir(v: number | null | undefined): "is-up" | "is-down" | "is-flat" {
  return typeof v === "number" && Number.isFinite(v) ? (v > 0 ? "is-up" : v < 0 ? "is-down" : "is-flat") : "is-flat";
}

// changePct is already a percentage (e.g. -3.1), not re-multiplied by 100;
// returnPct is a decimal and goes through fmtPct instead.
export function wdChg(p: number | null | undefined): { text: string; dir: "is-up" | "is-down" | "is-flat" } | null {
  if (typeof p !== "number" || !Number.isFinite(p)) return null;
  const dir = p > 0 ? "is-up" : p < 0 ? "is-down" : "is-flat";
  const sign = p > 0 ? "+" : p < 0 ? "−" : "";
  return { text: `${sign}${Math.abs(p).toFixed(1)}%`, dir };
}

export function wdWhen(date: string | null | undefined): string {
  const s = String(date || "");
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "今天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

// SQLite datetime('now') is UTC; render as relative time (mirrors format.js notifWhen).
export function notifWhen(createdAt: string): string {
  const t = Date.parse(
    createdAt.replace(" ", "T") + (createdAt.includes("Z") || createdAt.includes("+") ? "" : "Z")
  );
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const d = new Date(t);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
