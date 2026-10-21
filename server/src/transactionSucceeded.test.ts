import test from "node:test";
import assert from "node:assert/strict";
import { transactionSucceeded } from "./transactionSucceeded.js";

const successfulTransaction = {
  description: {
    aborted: false,
    destroyed: false,
    compute_ph: { success: true, skipped: false },
    action: { success: true, valid: true, no_funds: false },
  },
};

test("accepts a successful transaction using the production validator", () => {
  assert.equal(transactionSucceeded(successfulTransaction), true);
});

test("rejects missing transaction details", () => {
  assert.equal(transactionSucceeded({}), false);
  assert.equal(transactionSucceeded(null), false);
  assert.equal(transactionSucceeded({ description: {} }), false);
});

test("rejects aborted, destroyed, or incomplete transaction status", () => {
  for (const description of [
    { ...successfulTransaction.description, aborted: true },
    { ...successfulTransaction.description, destroyed: true },
    (({ destroyed: _destroyed, ...rest }) => rest)(successfulTransaction.description),
    { ...successfulTransaction.description, aborted: undefined },
  ]) {
    assert.equal(transactionSucceeded({ description }), false);
  }
});

test("requires an explicit successful compute phase and skipped=false", () => {
  for (const compute_ph of [
    undefined,
    { success: false, skipped: false },
    { success: true, skipped: true },
    { success: true },
  ]) {
    assert.equal(
      transactionSucceeded({
        description: { ...successfulTransaction.description, compute_ph },
      }),
      false,
    );
  }
});

test("rejects a failed or incomplete action phase", () => {
  for (const action of [
    { success: false, valid: true, no_funds: false },
    { success: true, valid: false, no_funds: false },
    { success: true, valid: true, no_funds: true },
    { success: true, valid: true },
    "invalid",
  ]) {
    assert.equal(
      transactionSucceeded({
        description: { ...successfulTransaction.description, action },
      }),
      false,
    );
  }
});

test("allows a successful simple transfer without an action phase", () => {
  const { action: _action, ...description } = successfulTransaction.description;
  assert.equal(transactionSucceeded({ description }), true);
});
