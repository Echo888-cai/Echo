import assert from "node:assert/strict";
import test from "node:test";
import {
  surprisePercentDecimal,
  equityValueFromMultipleDecimal,
  perShareDecimal
} from "./index.cjs";
import { computeSurprisePct } from "../domain/src/earnings.js";

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

test("native surprise calculation matches legacy display semantics on golden vectors", () => {
  for (const vector of SURPRISE_GOLDEN_VECTORS) {
    const exact = surprisePercentDecimal(vector.actual, vector.estimate);
    assert.equal(exact, vector.expected);
    const display = exact == null ? null : Math.round(Number(exact) * 10) / 10;
    assert.equal(display, computeSurprisePct(Number(vector.actual), Number(vector.estimate)));
  }
});
