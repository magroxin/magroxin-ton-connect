import assert from "node:assert/strict";
import test from "node:test";
import { Address } from "@ton/core";
import { buildInitialMintPayload, calculateDeploymentValue, snakeString } from "./jettonDeployment.js";

function decodeSnake(cell: ReturnType<typeof snakeString>): string {
  const chunks: Buffer[] = [];
  let current = cell;
  let first = true;

  while (true) {
    const slice = current.beginParse();
    if (first) {
      assert.equal(slice.loadUint(8), 0, "snake root must begin with 0x00");
      first = false;
    }
    const byteLength = Math.floor(slice.remainingBits / 8);
    if (byteLength > 0) chunks.push(slice.loadBuffer(byteLength));
    if (slice.remainingRefs === 0) break;
    assert.equal(slice.remainingRefs, 1, "snake data must use a single continuation ref");
    current = slice.loadRef();
  }

  return Buffer.concat(chunks).toString("utf8");
}

test("snakeString writes the TEP-64 0x00 prefix for empty and short values", () => {
  assert.equal(decodeSnake(snakeString("")), "");
  assert.equal(decodeSnake(snakeString("MAGROXIN")), "MAGROXIN");
});

test("snakeString respects the first-cell and continuation byte limits", () => {
  for (const length of [126, 127, 253, 254, 380, 1000]) {
    const value = "x".repeat(length);
    assert.equal(decodeSnake(snakeString(value)), value);
  }
});

test("snakeString preserves multi-byte UTF-8 characters across cell boundaries", () => {
  const value = "MAGROXIN-টোকেন-🚀-".repeat(30);
  assert.equal(decodeSnake(snakeString(value)), value);
});

test("initial mint payload follows the classic TON minter mintBody layout", () => {
  const owner = Address.parse("0:" + "11".repeat(32));
  const supply = 123456789000n;
  const payload = buildInitialMintPayload(owner, supply);
  const outer = payload.beginParse();

  assert.equal(outer.loadUint(32), 21);
  assert.equal(outer.loadUintBig(64), 0n);
  assert.equal(outer.loadAddress()?.toRawString(), owner.toRawString());
  assert.equal(outer.loadCoins(), 300000000n);

  const mint = outer.loadRef().beginParse();
  assert.equal(mint.loadUint(32), 0x178d4519);
  assert.equal(mint.loadUintBig(64), 0n);
  assert.equal(mint.loadCoins(), supply);
  assert.equal(mint.loadAddress(), null, "from_address must be addr_none");
  assert.equal(mint.loadAddress()?.toRawString(), owner.toRawString());
  assert.equal(mint.loadCoins(), 1000000n, "forward TON amount must be 0.001 TON");
  assert.equal(mint.loadBit(), false);
});

test("deployment value funds the mint transfer in addition to execution fees", () => {
  const estimatedFees = 10000000n;
  const value = calculateDeploymentValue(estimatedFees);
  assert.equal(value, 300000000n + estimatedFees + (estimatedFees * 30n / 100n) + 50000000n);
  assert.ok(value > 300000000n, "transaction value must cover the 0.3 TON mint-to-wallet amount plus fees");
  assert.throws(() => calculateDeploymentValue(0n), /zero deployment fee estimate/i);
});
