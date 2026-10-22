import { createHash } from "node:crypto";

export interface ApiRateLimitRule {
  scope: string;
  maxRequests: number;
  windowSeconds: number;
}

/** Rate limits for endpoints that can trigger costly provider lookups or state changes. */
export function getApiRateLimitRule(
  method: string,
  path: string,
): ApiRateLimitRule | null {
  const normalizedMethod = method.toUpperCase();

  if (normalizedMethod === "POST" && path === "/api/orders") {
    return { scope: "order-create", maxRequests: 10, windowSeconds: 60 };
  }

  if (
    normalizedMethod === "GET" &&
    /^\/api\/orders\/[0-9a-f-]+\/payment-request$/i.test(path)
  ) {
    return { scope: "payment-request", maxRequests: 10, windowSeconds: 60 };
  }

  if (
    normalizedMethod === "POST" &&
    /^\/api\/orders\/[0-9a-f-]+\/verify$/i.test(path)
  ) {
    return { scope: "payment-verify", maxRequests: 5, windowSeconds: 60 };
  }

  if (
    normalizedMethod === "GET" &&
    /^\/api\/orders\/[0-9a-f-]+$/i.test(path)
  ) {
    return { scope: "order-status", maxRequests: 60, windowSeconds: 60 };
  }

  return null;
}

/** Hash client identifiers before persistence; raw IP addresses are not stored. */
export function hashRateLimitClientKey(ip: string, scope: string): string {
  return createHash("sha256").update(`${scope}: ${ip}`).digest("hex");
}
