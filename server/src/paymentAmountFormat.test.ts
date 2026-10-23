import test from "node:test";
import assert from "node:assert/strict";
import { matchIncomingPaymentTransaction } from "./paymentTransactionMatcher.js";

const hash = "KkpVTX9RwiZcug8KQuOFUF8+eNoxuHVuIFpGQqufCWU=";
const expected = {
  sender: "sender",
  recipient: "fee-wallet",
  expectedAmount: 123456789n,
  start: 1_800_000_000,
  end: 1_800_000_300,
  expectedComment: "MAGROXIN:order-123",
};
const dependencies = {
  normalizeAddress(value: string) {
    return value.toLowerCase();
  },
  decodeComment() {
    return null;
  },
};
const tx = {
  hash,
  now: 1_800_000_100,
  description: {
    aborted: false,
    destroyed: false,
    compute_ph: { success: true, skipped: false },
    action: { success: true, valid: true, no_funds: false },
  },
  in_msg: {
    bounced: false,
    source: "sender",
    destination: "fee-wallet",
    value: "123456789",
    message_content: { decoded: { comment: "MAGROXIN:order-123" } },
  },
};

test("accepts decimal nanoTON strings only", () => {
  assert.deepEqual(
    matchIncomingPaymentTransaction(tx, expected, dependencies),
    { hash },
  );
});

test("rejects alternative or ambiguous amount encodings", () => {
  for (const value of [
    "0x75bcd15",
    "+123456789",
    "-123456789",
    " 123456789",
    "123456789 ",
    "0123456789",
    "",
    "1e8",
    123456789,
    null,
  ]) {
    assert.equal(
      matchIncomingPaymentTransaction(
        { ...tx, in_msg: { ...tx.in_msg, value } },
        expected,
        dependencies,
      ),
      null,
      `should reject amount encoding: ${String(value)}`,
    );
  }
});
