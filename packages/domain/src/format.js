/**
 * Small helpers shared across services. Keep this file dependency-free.
 */

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
