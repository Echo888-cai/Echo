// Shared date, market and number formatting helpers.
import { marketLabel } from "./market";

// Market label: three-way (港股/美股/A股), reuses market.ts's detectMarket. Blank ticker -> "".
export function marketLabelOf(ticker: string | null | undefined): string {
  if (!ticker) return "";
  return marketLabel(ticker);
}

export const isNum = (v: unknown): v is number => v != null && v !== "" && Number.isFinite(Number(v));
export const fmtMoney = (v: unknown): string => (isNum(v) ? (Math.abs(Number(v)) >= 100 ? Number(v).toFixed(0) : Number(v).toFixed(2)) : "—");
export const fmtSigned = (v: unknown): string | null => (isNum(v) ? `${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(1)}%` : null);
export const dirClass = (v: unknown): "up" | "down" | "flat" => (Number(v) > 0 ? "up" : Number(v) < 0 ? "down" : "flat");

export function numFrom(value: unknown): number | null {
  const n = parseFloat(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function hostFromUrl(url = ""): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function credLevel(score: number | null | undefined): "high" | "mid" | "low" {
  if (typeof score !== "number") return "mid";
  if (score >= 0.7) return "high";
  if (score >= 0.45) return "mid";
  return "low";
}

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

// Stored timestamps are UTC and render as relative local time.
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
