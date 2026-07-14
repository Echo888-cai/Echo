import assert from "node:assert/strict";
import test from "node:test";
import {
  surprisePercentDecimal,
  equityValueFromMultipleDecimal,
  perShareDecimal,
  multiplyDecimal,
  subtractDecimal,
  ratioDecimal
} from "./index.cjs";

const SURPRISE_GOLDEN_VECTORS = [
  { actual: "1.05", estimate: "1.00", expected: "5" },
  { actual: "0.95", estimate: "1.00", expected: "-5" },
  { actual: "-0.8", estimate: "-1", expected: "20" },
  { actual: "-1.2", estimate: "-1", expected: "-20" },
  { actual: "0.123456789", estimate: "0.1", expected: "23.5" },
  { actual: "1", estimate: "0", expected: null }
];

test("N-API uses the Rust exact-decimal kernel", () => {
  assert.equal(surprisePercentDecimal("1.05", "1.00"), "5");
  assert.equal(surprisePercentDecimal("1", "0"), null);
  const equity = equityValueFromMultipleDecimal("650000000", "10", "1390000000", "USD");
  assert.deepEqual(equity, { amount: "7890000000", currency: "USD" });
  assert.deepEqual(perShareDecimal(equity.amount, "550000000", 2, "USD"), { amount: "14.35", currency: "USD" });
});

test("native surprise calculation matches exact golden vectors", () => {
  for (const vector of SURPRISE_GOLDEN_VECTORS) {
    const exact = surprisePercentDecimal(vector.actual, vector.estimate);
    assert.equal(exact, vector.expected);
  }
});

test("position P&L primitives replace apps/api's former JS-float arithmetic", () => {
  // 100 shares @ 317.31 vs. cost basis 280.00 — same scenario as
  // apps/api/src/app.ts's enrichPosition, exercised end-to-end through N-API.
  const marketValue = multiplyDecimal("317.31", "100", "USD");
  const costValue = multiplyDecimal("280.00", "100", "USD");
  assert.deepEqual(marketValue, { amount: "31731", currency: "USD" });
  assert.deepEqual(costValue, { amount: "28000", currency: "USD" });
  const unrealizedPnl = subtractDecimal(marketValue.amount, costValue.amount, "USD");
  assert.deepEqual(unrealizedPnl, { amount: "3731", currency: "USD" });
  const gain = subtractDecimal("317.31", "280.00", "USD");
  assert.equal(ratioDecimal(gain.amount, "280.00", "USD"), "0.13325");
  // Zero denominator degrades to null rather than Infinity/NaN — currency
  // mismatch itself is covered at the Rust layer (crates/finance-core), since
  // these N-API wrappers apply one currencyCode to both operands and so can't
  // construct a mismatched pair through this boundary.
  assert.equal(ratioDecimal("1", "0", "USD"), null);
});
