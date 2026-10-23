import test from "node:test";
import assert from "node:assert/strict";
import { isSupportedJettonSupply } from "./tokenSupply.js";

test("accepts ordinary positive supplies", () => {
  assert.equal(isSupportedJettonSupply("1000000", 9), true);
});

test("uses BigInt precision for supplies beyond Number safe integer", () => {
  assert.equal(isSupportedJettonSupply("9007199254740993", 0), true);
});

test("rejects supplies above the supported unit limit", () => {
  assert.equal(isSupportedJettonSupply("1000000000000000000000000000001", 0), false);
});

test("rejects invalid supply and decimal values", () => {
  assert.equal(isSupportedJettonSupply("0", 0), false);
  assert.equal(isSupportedJettonSupply("-1", 0), false);
  assert.equal(isSupportedJettonSupply("1.5", 0), false);
  assert.equal(isSupportedJettonSupply("1", 10), false);
});
