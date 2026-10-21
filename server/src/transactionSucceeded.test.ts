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

test("rejects an aborted transaction", () => {
  assert.equal(
    transactionSucceeded({
      description: {
        ...successfulTransaction.description,
        aborted: true,
      },
    }),
    false,
  );
});

test("rejects missing transaction details", () => {
  assert.equal(transactionSucceeded({}), false);
  assert.equal(transactionSucceeded(null), false);
  assert.equal(transactionSucceeded({ description: {} }), false);
});

test("rejects a failed or skipped compute phase", () => {
  assert.equal(
    transactionSucceeded({
      description: {
        ...successfulTransaction.description,
        compute_ph: { success: false },
      },
    }),
    false,
  );
  assert.equal(
    transactionSucceeded({
      description: {
        ...successfulTransaction.description,
        compute_ph: { success: true, skipped: true },
      },
    }),
    false,
  );
});

test("rejects a missing destroyed status", () => {
  const { destroyed: _destroyed, ...description } = successfulTransaction.description;
  assert.equal(transactionSucceeded({ description }), false);
});

test("rejects a destroyed transaction", () => {
  assert.equal(
    transactionSucceeded({
      description: {
        ...successfulTransaction.description,
        destroyed: true,
      },
    }),
    false,
  );
});

test("rejects a failed or invalid action phase", () => {
  for (const action of [
    { success: false, valid: true, no_funds: false },
    { success: true, valid: false, no_funds: false },
    { success: true, valid: true, no_funds: true },
  ]) {
    assert.equal(
      transactionSucceeded({
        description: {
          ...successfulTransaction.description,
          action,
        },
      }),
      false,
    );
  }
});
