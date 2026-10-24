import test from "node:test";
import assert from "node:assert/strict";
import { readDeploymentPaymentConfig } from "./deploymentPaymentConfig.js";

const validWallet = "UQBTg_3TAIDodXCiptBQjrRGR7JRfVK7nLBLL93LOfxsCx-5";

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

test("rejects malformed TON recipient addresses", () => {
  assert.equal(readDeploymentPaymentConfig({
    ENABLE_DEPLOYMENT_PAYMENT: "true",
    DEPLOYMENT_PAYMENT_WALLET: "not-a-ton-wallet",
    DEPLOYMENT_PAYMENT_AMOUNT_NANO: "1500000000",
  }).enabled, false);
});

test("rejects zero, decimals, signs and malformed nanoTON amounts", () => {
  for (const amount of ["0", "1.5", "-2", "+3", " 4", "abc"]) {
    assert.equal(readDeploymentPaymentConfig({
      ENABLE_DEPLOYMENT_PAYMENT: "true",
      DEPLOYMENT_PAYMENT_WALLET: validWallet,
      DEPLOYMENT_PAYMENT_AMOUNT_NANO: amount,
    }).enabled, false);
  }
});

test("accepts a valid explicit config and normalizes the recipient", () => {
  const result = readDeploymentPaymentConfig({
    ENABLE_DEPLOYMENT_PAYMENT: "true",
    DEPLOYMENT_PAYMENT_WALLET: validWallet,
    DEPLOYMENT_PAYMENT_AMOUNT_NANO: "1500000000",
  });
  assert.equal(result.enabled, true);
  assert.equal(result.amountNano, "1500000000");
  assert.equal(result.recipient, "0:" + "d1b2d0c3b2f2c8c0a5b6d8f5d8e6c3b0a2c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3");
});
