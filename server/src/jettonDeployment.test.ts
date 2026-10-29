import assert from "node:assert/strict";
import test from "node:test";
import { snakeString } from "./jettonDeployment.js";

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
