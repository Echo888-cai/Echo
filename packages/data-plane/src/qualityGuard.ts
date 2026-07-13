/** Conservative validation for external data before it crosses the data-plane boundary. */
import type { ProviderEnvelope, QuoteResult } from "./ports.js";

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

/**
 * Loose check for the fundamentals/filings/calendar envelope shape — these
 * ports don't have a second real adapter yet to design a richer per-field
 * guard against (same reasoning as ports.ts's ProviderEnvelope), so this only
 * checks the one thing every one of them promises: an honest providerStatus.
 * `asOf` is checked only when the envelope actually declares the key — not
 * every provider has an "as of" freshness concept (earningsCalendar.js's
 * envelope reports `nextDate` instead, which isn't a staleness timestamp).
 */
export function checkEnvelope(result: ProviderEnvelope): QualityReport {
  if (result.providerStatus !== "ok") return { ok: true, score: 100, issues: [] };
  if ("asOf" in result && (!result.asOf || Number.isNaN(Date.parse(result.asOf)))) {
    return {
      ok: false,
      score: 50,
      issues: [{ field: "asOf", severity: "reject", message: "providerStatus=ok but asOf is missing or unparseable" }]
    };
  }
  return { ok: true, score: 100, issues: [] };
}
