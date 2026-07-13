/** Earnings surprise: (actual - estimate) / |estimate|. */
export function computeSurprisePct(actual, estimate) {
  if (actual == null || estimate == null || estimate === 0) return null;
  return Math.round(((actual - estimate) / Math.abs(estimate)) * 1000) / 10;
}
