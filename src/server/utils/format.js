/**
 * Small helpers shared across services. Keep this file dependency-free.
 */

export function missing(value) {
  return value === null || value === undefined || value === "" ? "缺失" : value;
}

export function fmtPercent(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? "缺失" : `${Number(value).toFixed(2)}%`;
}

/** Compact-number formatter (万亿/亿/万) used for HK$ amounts. */
export function compactNumberServer(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "缺失";
  if (Math.abs(number) >= 1e12) return `${(number / 1e12).toFixed(2)} 万亿`;
  if (Math.abs(number) >= 1e8) return `${(number / 1e8).toFixed(2)} 亿`;
  if (Math.abs(number) >= 1e4) return `${(number / 1e4).toFixed(2)} 万`;
  return `${number.toFixed(2)}`;
}

export function quoteStatusFor(snapshot) {
  if (!snapshot || snapshot.providerStatus !== "ok") return "缺失";
  const asOf = snapshot.asOf ? new Date(snapshot.asOf) : null;
  if (!asOf || Number.isNaN(asOf.getTime())) return "延迟/时间未知";
  const ageMinutes = (Date.now() - asOf.getTime()) / 60000;
  if (ageMinutes <= 20) return "实时/盘中";
  if (ageMinutes <= 24 * 60) return "延迟/当日";
  return "收盘/历史";
}
