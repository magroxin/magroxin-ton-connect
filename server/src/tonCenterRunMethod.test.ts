import test from "node:test";
import assert from "node:assert/strict";
import { Address, beginCell } from "@ton/core";
import { getRunMethodStack, readRunMethodAddress, readRunMethodInteger } from "./tonCenterRunMethod.js";

test("reads TON Center v2 result.stack integers", () => {
  assert.equal(readRunMethodInteger({ ok: true, result: { stack: [["num", "0x2a"]] } }), 42n);
});

test("accepts a top-level stack compatibility response", () => {
  assert.equal(readRunMethodInteger({ ok: true, stack: [["num", "123"]] }), 123n);
});

test("reads a TON address encoded as a BOC slice", () => {
  const expected = Address.parse("0:" + "11".repeat(32));
  const bytes = beginCell().storeAddress(expected).endCell().toBoc().toString("base64");
  const actual = readRunMethodAddress({ ok: true, result: { stack: [["slice", { bytes }]] } });
  assert.equal(actual.toRawString(), expected.toRawString());
});

test("rejects incomplete or malformed getter responses", () => {
  assert.throws(() => getRunMethodStack({ ok: false }), /ok=true/);
  assert.throws(() => getRunMethodStack({ ok: true, result: {} }), /result.stack/);
  assert.throws(() => readRunMethodInteger({ ok: true, result: { stack: [["cell", {}]] } }));
  assert.throws(() => readRunMethodAddress({ ok: true, result: { stack: [["num", "0x1"]] } }));
});
