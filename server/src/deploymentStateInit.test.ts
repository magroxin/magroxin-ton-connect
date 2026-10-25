import test from "node:test";
import assert from "node:assert/strict";
import { stateInitMatchesAddress } from "./deploymentStateInit.js";

test("rejects missing or malformed StateInit BOCs", () => {
  assert.equal(stateInitMatchesAddress(undefined, "0:" + "0".repeat(64)), false);
  assert.equal(stateInitMatchesAddress("", "0:" + "0".repeat(64)), false);
  assert.equal(stateInitMatchesAddress("not-base64!", "0:" + "0".repeat(64)), false);
});

test("rejects malformed claimed addresses", () => {
  assert.equal(stateInitMatchesAddress("AA==", "not-an-address"), false);
});

test("rejects StateInit BOCs with an invalid root structure", () => {
  // A single empty cell is not a complete serialized StateInit.
  const emptyCellBoc = "te6ccgEBAQEAAgAAAA==";
  assert.equal(
    stateInitMatchesAddress(emptyCellBoc, "0:" + "0".repeat(64)),
    false,
  );
});
