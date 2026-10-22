import test from "node:test";
import assert from "node:assert/strict";
import { calculateFeeTon } from "./feeQuote.js";

test("calculates exact six-decimal TON quotes", () => {
  assert.equal(calculateFeeTon(100, 200), "0.500000");
});

test("rounds upward when six-decimal rounding would otherwise undercharge", () => {
  assert.equal(calculateFeeTon(100, 300), "0.333334");
  assert.ok(Number(calculateFeeTon(100, 300)) * 300 >= 100);
});

test("rejects invalid USD fees and TON prices", () => {
  for (const [fee, price] of [
    [0, 10],
    [-1, 10],
    [Number.NaN, 10],
    [100, 0],
    [100, -2],
    [100, Number.POSITIVE_INFINITY],
  ]) {
    assert.throws(() => calculateFeeTon(fee, price));
  }
});
