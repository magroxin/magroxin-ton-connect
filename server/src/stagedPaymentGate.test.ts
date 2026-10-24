import test from "node:test";
import assert from "node:assert/strict";
import { canPrepareDeployment, type StagedPaymentGate } from "./stagedPaymentGate.js";

const paidBoth: StagedPaymentGate = {
  serviceFeeStatus: "paid",
  serviceFeeTxHash: "service-tx",
  deploymentPaymentStatus: "paid",
  deploymentPaymentTxHash: "deployment-tx",
};

test("allows preparation only when both distinct payments are verified", () => {
  assert.equal(canPrepareDeployment(paidBoth), true);
});

test("blocks deployment when service fee is not paid", () => {
  for (const status of ["created", "expired", "failed"] as const) {
    assert.equal(canPrepareDeployment({ ...paidBoth, serviceFeeStatus: status }), false);
  }
});

test("blocks deployment when deployment cost is not paid", () => {
  for (const status of ["created", "expired", "failed"] as const) {
    assert.equal(canPrepareDeployment({ ...paidBoth, deploymentPaymentStatus: status }), false);
  }
});

test("fails closed when either verified transaction hash is absent or blank", () => {
  assert.equal(canPrepareDeployment({ ...paidBoth, serviceFeeTxHash: null }), false);
  assert.equal(canPrepareDeployment({ ...paidBoth, serviceFeeTxHash: "  " }), false);
  assert.equal(canPrepareDeployment({ ...paidBoth, deploymentPaymentTxHash: null }), false);
  assert.equal(canPrepareDeployment({ ...paidBoth, deploymentPaymentTxHash: " " }), false);
});

test("rejects reusing the same transaction for both payment stages", () => {
  assert.equal(
    canPrepareDeployment({ ...paidBoth, deploymentPaymentTxHash: paidBoth.serviceFeeTxHash }),
    false,
  );
});
