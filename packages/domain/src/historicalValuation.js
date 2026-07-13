function percentileOf(current, sortedValues) {
  if (!sortedValues.length) return null;
  const below = sortedValues.filter((value) => value <= current).length;
  return Math.round((below / sortedValues.length) * 100);
}

/** Compute the live PE percentile against an already-grounded annual series. */
export function computeHistoricalValuationPercentile(seriesResult, currentPe) {
  const { series = [], providerStatus, detail, stale = false } = seriesResult || {};
  const sortedPeriods = [...series].sort((a, b) => (a.period < b.period ? 1 : -1));
  const oldestPeriod = sortedPeriods.at(-1)?.period || null;
  const newestPeriod = sortedPeriods[0]?.period || null;

  if (providerStatus !== "ok" || !Number.isFinite(currentPe) || currentPe <= 0) {
    return {
      providerStatus: providerStatus === "ok" ? "missing" : providerStatus,
      metric: "pe",
      currentValue: Number.isFinite(currentPe) ? currentPe : null,
      percentile: null,
      sampleYears: series.length,
      min: null,
      max: null,
      median: null,
      oldestPeriod,
      newestPeriod,
      detail: providerStatus === "ok" ? "当前 PE 不可用，无法计算历史分位" : detail,
      stale
    };
  }

  const values = series.map((item) => item.value).sort((a, b) => a - b);
  return {
    providerStatus: "ok",
    metric: "pe",
    currentValue: currentPe,
    percentile: percentileOf(currentPe, values),
    sampleYears: values.length,
    min: values[0],
    max: values.at(-1),
    median: values[Math.floor(values.length / 2)],
    oldestPeriod,
    newestPeriod,
    detail: null,
    stale
  };
}
