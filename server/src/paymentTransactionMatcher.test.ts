import test from "node:test";
import assert from "node:assert/strict";
import { matchIncomingPaymentTransaction } from "./paymentTransactionMatcher.js";

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
    if (value === "bad-address") throw new Error("invalid address");
    return value.toLowerCase();
  },
  decodeComment(_body: unknown) {
    return null;
  },
};

const validTx = {
  hash: "abc123",
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
    message_content: {
      decoded: { comment: "MAGROXIN:order-123" },
    },
  },
};

test("accepts an exact successful incoming payment", () => {
  assert.deepEqual(
    matchIncomingPaymentTransaction(validTx, expected, dependencies),
    { hash: "abc123" },
  );
});

test("rejects missing or malformed transactions and messages", () => {
  for (const tx of [
    null,
    {},
    { ...validTx, hash: "" },
    { ...validTx, now: "not-a-time" },
    { ...validTx, in_msg: null },
    { ...validTx, in_msg: { ...validTx.in_msg, bounced: undefined } },
    { ...validTx, in_msg: { ...validTx.in_msg, bounced: true } },
    { ...validTx, in_msg: { ...validTx.in_msg, source: "bad-address" } },
    { ...validTx, in_msg: { ...validTx.in_msg, value: "not-a-number" } },
    { ...validTx, in_msg: { ...validTx.in_msg, value: null } },
  ]) {
    assert.equal(
      matchIncomingPaymentTransaction(tx, expected, dependencies),
      null,
    );
  }
});

test("rejects sender, recipient, amount, and comment mismatches", () => {
  const variants = [
    { ...validTx, in_msg: { ...validTx.in_msg, source: "attacker" } },
    { ...validTx, in_msg: { ...validTx.in_msg, destination: "other-wallet" } },
    { ...validTx, in_msg: { ...validTx.in_msg, value: "123456788" } },
    {
      ...validTx,
      in_msg: {
        ...validTx.in_msg,
        message_content: { decoded: { comment: "MAGROXIN:another-order" } },
      },
    },
  ];

  for (const tx of variants) {
    assert.equal(
      matchIncomingPaymentTransaction(tx, expected, dependencies),
      null,
    );
  }
});

test("rejects transactions outside the order time window", () => {
  for (const now of [expected.start - 1, expected.end + 1]) {
    assert.equal(
      matchIncomingPaymentTransaction({ ...validTx, now }, expected, dependencies),
      null,
    );
  }
});

test("uses decoded text and falls back to a decoded body comment", () => {
  const textTx = {
    ...validTx,
    in_msg: {
      ...validTx.in_msg,
      message_content: { decoded: { text: expected.expectedComment } },
    },
  };
  assert.deepEqual(
    matchIncomingPaymentTransaction(textTx, expected, dependencies),
    { hash: "abc123" },
  );

  const bodyTx = {
    ...validTx,
    in_msg: { ...validTx.in_msg, message_content: { body: "encoded-body" } },
  };
  const bodyDependencies = {
    ...dependencies,
    decodeComment(body: unknown) {
      return body === "encoded-body" ? expected.expectedComment : null;
    },
  };
  assert.deepEqual(
    matchIncomingPaymentTransaction(bodyTx, expected, bodyDependencies),
    { hash: "abc123" },
  );
});


test("rejects transactions whose compute or action phase failed", () => {
  const variants = [
    {
      ...validTx,
      description: {
        ...validTx.description,
        aborted: true,
      },
    },
    {
      ...validTx,
      description: {
        ...validTx.description,
        destroyed: true,
      },
    },
    {
      ...validTx,
      description: {
        ...validTx.description,
        compute_ph: { success: false, skipped: false },
      },
    },
    {
      ...validTx,
      description: {
        ...validTx.description,
        compute_ph: { success: true, skipped: true },
      },
    },
    {
      ...validTx,
      description: {
        ...validTx.description,
        action: { success: false, valid: true, no_funds: false },
      },
    },
    {
      ...validTx,
      description: {
        ...validTx.description,
        action: { success: true, valid: true, no_funds: true },
      },
    },
  ];

  for (const tx of variants) {
    assert.equal(
      matchIncomingPaymentTransaction(tx, expected, dependencies),
      null,
    );
  }
});

test("rejects fractional timestamps and missing transaction hashes", () => {
  for (const tx of [
    { ...validTx, now: 1_800_000_100.5 },
    { ...validTx, hash: undefined },
    { ...validTx, hash: 123 },
  ]) {
    assert.equal(
      matchIncomingPaymentTransaction(tx, expected, dependencies),
      null,
    );
  }
});

test("does not accept a payment comment from an unrelated decoded field", () => {
  const tx = {
    ...validTx,
    in_msg: {
      ...validTx.in_msg,
      message_content: {
        decoded: { comment: "MAGROXIN:another-order", text: expected.expectedComment },
      },
    },
  };

  assert.equal(
    matchIncomingPaymentTransaction(tx, expected, dependencies),
    null,
  );
});
