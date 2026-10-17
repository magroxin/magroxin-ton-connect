
import test from "node:test";
import assert from "node:assert/strict";

function transactionSucceeded(tx: any): boolean {
  const description = tx?.description;

  if (!description || typeof description !== "object") {
    return false;
  }

  if (description.aborted !== false) return false;
  if (description.destroyed !== false) return false;

  const compute = description.compute_ph;

  if (!compute || compute.success !== true) {
    return false;
  }

  if (compute.skipped === true) return false;

  const action = description.action;

  if (
    action !== undefined &&
    (
      !action ||
      action.success !== true ||
      action.valid !== true ||
      action.no_funds === true
    )
  ) {
    return false;
  }

  return true;
}

test("accepts a successful transaction", () => {
  assert.equal(
    transactionSucceeded({
      description: {
        aborted: false,
        destroyed: false,
        compute_ph: {
          success: true,
          skipped: false,
        },
        action: {
          success: true,
          valid: true,
          no_funds: false,
        },
      },
    }),
    true,
  );
});

test("rejects an aborted transaction", () => {
  assert.equal(
    transactionSucceeded({
      description: {
        aborted: true,
        destroyed: false,
        compute_ph: { success: true },
      },
    }),
    false,
  );
});

test("rejects a failed compute phase", () => {
  assert.equal(
    transactionSucceeded({
      description: {
        aborted: false,
        destroyed: false,
        compute_ph: { success: false },
      },
    }),
    false,
  );
});

test("rejects missing transaction details", () => {
  assert.equal(transactionSucceeded({}), false);
  assert.equal(transactionSucceeded(null), false);
});

test("rejects a failed action phase", () => {
  assert.equal(
    transactionSucceeded({
      description: {
        aborted: false,
        destroyed: false,
        compute_ph: { success: true },
        action: {
          success: false,
          valid: true,
          no_funds: false,
        },
      },
    }),
    false,
  );
});
