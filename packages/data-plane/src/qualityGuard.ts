/**
 * Data quality guard (REFACTOR_PROPOSAL.md §4.5: "所有外部响应进入数据平面前过
 * 数据质量守卫...量纲、币种、可比性、异常跳变检查，带质量评分入库"). This is new
 * logic — nothing in the legacy code validates a quote's shape before use today
 * (marketData.js reports providerStatus:"missing" on fetch failure, but never
 * checks whether a "successful" response is actually sane). Deliberately
 * conservative: flags issues, does not silently repair or drop fields — the
 * caller decides what to do with a flagged result (matches the codebase's
 * existing "诚实降级" convention rather than inventing a new one).
 */
import type { QuoteResult } from "./ports.js";

export interface QualityIssue {
  field: string;
  severity: "warn" | "reject";
  message: string;
}

export interface QualityReport {
  ok: boolean;
  score: number; // 0-100, 100 = no issues
  issues: QualityIssue[];
}

// A single-session daily move beyond this is flagged, not rejected — real
// stocks do occasionally move this much (halts, earnings gaps); the guard's
// job is to make it visible, not to second-guess the market.
const SUSPICIOUS_DAILY_MOVE_PCT = 40;

export function checkQuote(result: QuoteResult): QualityReport {
  const issues: QualityIssue[] = [];

  if (result.providerStatus !== "ok") {
    // An honest "missing" isn't a quality defect — it's the adapter declining
    // to guess. Nothing further to check.
    return { ok: true, score: 100, issues: [] };
  }

  if (result.price == null || !Number.isFinite(result.price) || result.price <= 0) {
    issues.push({ field: "price", severity: "reject", message: "price is missing, non-finite, or non-positive" });
  }
  if (!result.currency) {
    issues.push({ field: "currency", severity: "reject", message: "currency missing — a bare number is not a quote" });
  }
  if (!result.asOf || Number.isNaN(Date.parse(result.asOf))) {
    issues.push({ field: "asOf", severity: "reject", message: "asOf is missing or unparseable" });
  } else {
    const ageMs = Date.now() - Date.parse(result.asOf);
    // >7 days stale is almost certainly a provider serving a cached/delisted
    // quote rather than a live one; flag rather than reject since some
    // adapters (e.g. thinly-traded HK names) can legitimately go quiet.
    if (ageMs > 7 * 24 * 60 * 60 * 1000) {
      issues.push({ field: "asOf", severity: "warn", message: `quote is ${Math.round(ageMs / 86400000)} days old` });
    }
  }
  if (
    typeof result.changePercent === "number" &&
    Number.isFinite(result.changePercent) &&
    Math.abs(result.changePercent) > SUSPICIOUS_DAILY_MOVE_PCT
  ) {
    issues.push({
      field: "changePercent",
      severity: "warn",
      message: `${result.changePercent}% daily move exceeds ${SUSPICIOUS_DAILY_MOVE_PCT}% sanity threshold — verify before trusting`
    });
  }
  if (
    typeof result.price === "number" &&
    typeof result.previousClose === "number" &&
    result.previousClose > 0 &&
    typeof result.changePercent === "number"
  ) {
    const impliedPct = ((result.price - result.previousClose) / result.previousClose) * 100;
    // Loose tolerance (2 abs pts) — providers round differently, not a bug.
    if (Math.abs(impliedPct - result.changePercent) > 2) {
      issues.push({
        field: "changePercent",
        severity: "warn",
        message: `changePercent (${result.changePercent}%) doesn't match price/previousClose implied move (${impliedPct.toFixed(1)}%)`
      });
    }
  }

  const rejectCount = issues.filter((i) => i.severity === "reject").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;
  const score = Math.max(0, 100 - rejectCount * 50 - warnCount * 15);
  return { ok: rejectCount === 0, score, issues };
}
