import test from "node:test";
import assert from "node:assert/strict";
import { readDeploymentPaymentConfig } from "./deploymentPaymentConfig.js";

test("deployment payment remains disabled by default", () => {
  assert.deepEqual(readDeploymentPaymentConfig({}), {
    enabled: false,
    recipient: "",
    amountNano: "",
  });
});

test("explicit enable without recipient and amount fails closed", () => {
  assert.equal(readDeploymentPaymentConfig({
    ENABLE_DEPLOYMENT_PAYMENT: "true",
  }).enabled, false);
});

test("rejects zero, decimals, signs and malformed nanoTON amounts", () => {
  for (const amount of ["0", "1.5", "-2", "+3", " 4", "abc"]) {
    assert.equal(readDeploymentPaymentConfig({
      ENABLE_DEPLOYMENT_PAYMENT: "true",
      DEPLOYMENT_PAYMENT_WALLET: "configured-wallet",
      DEPLOYMENT_PAYMENT_AMOUNT_NANO: amount,
    }).enabled, false);
  }
});

test("accepts explicit complete configuration without silently inventing values", () => {
  assert.deepEqual(readDeploymentPaymentConfig({
    ENABLE_DEPLOYMENT_PAYMENT: "true",
    DEPLOYMENT_PAYMENT_WALLET: "configured-wallet",
    DEPLOYMENT_PAYMENT_AMOUNT_NANO: "1500000000",
  }), {
    enabled: true,
    recipient: "configured-wallet",
    amountNano: "1500000000",
  });
});
