import test from "node:test";
import assert from "node:assert/strict";
import { getApiRateLimitRule, hashRateLimitClientKey } from "./apiRateLimit.js";

test("sets stricter limits for order creation and payment verification", () => {
  assert.deepEqual(getApiRateLimitRule("POST", "/api/orders"), {
    scope: "order-create",
    maxRequests: 10,
    windowSeconds: 60,
  });
  assert.deepEqual(
    getApiRateLimitRule("POST", "/api/orders/123e4567-e89b-12d3-a456-426614174000/verify"),
    {
      scope: "payment-verify",
      maxRequests: 5,
      windowSeconds: 60,
    },
  );
});

test("limits payment requests and permits a reasonable order-status poll rate", () => {
  assert.equal(
    getApiRateLimitRule("GET", "/api/orders/123e4567-e89b-12d3-a456-426614174000/payment-request")?.maxRequests,
    10,
  );
  assert.equal(
    getApiRateLimitRule("GET", "/api/orders/123e4567-e89b-12d3-a456-426614174000")?.maxRequests,
    60,
  );
});

test("does not apply order limits to unrelated paths or methods", () => {
  assert.equal(getApiRateLimitRule("DELETE", "/api/orders"), null);
  assert.equal(getApiRateLimitRule("POST", "/api/orders/not-a-uuid/verify"), null);
  assert.equal(getApiRateLimitRule("GET", "/health"), null);
});

test("hashes client identifiers deterministically without exposing raw IP", () => {
  const first = hashRateLimitClientKey("203.0.113.7", "order-create");
  assert.equal(first, hashRateLimitClientKey("203.0.113.7", "order-create"));
  assert.notEqual(first, hashRateLimitClientKey("203.0.113.8", "order-create"));
  assert.notEqual(first, hashRateLimitClientKey("203.0.113.7", "payment-verify"));
  assert.match(first, /^[a-f0-9]{64}$/);
});
