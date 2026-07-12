// Shared formatting helpers ported from src/ui/format.js. React auto-escapes
// interpolated text, so esc() itself is not needed here — only the pure
// date/number helpers actually used by the migrated components.

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
