import { Address, Cell, contractAddress, loadStateInit } from "@ton/core";

/**
 * Derive a contract address from the StateInit BOC, rather than trusting an
 * address supplied separately by the browser. This is only an address/BOC
 * consistency check; it does NOT prove that the account is deployed on-chain.
 */
export function deriveAddressFromStateInitBoc(
  stateInitBocBase64: unknown,
): string {
  if (
    typeof stateInitBocBase64 !== "string" ||
    stateInitBocBase64.length === 0 ||
    stateInitBocBase64.length > 100_000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(stateInitBocBase64)
  ) {
    throw new Error("Invalid StateInit BOC.");
  }

  // @ton/core Cell.fromBase64 returns the single root Cell directly.
  const root = Cell.fromBase64(stateInitBocBase64);
  const slice = root.beginParse();
  const stateInit = loadStateInit(slice);
  if (slice.remainingBits !== 0 || slice.remainingRefs !== 0) {
    throw new Error("StateInit BOC contains unexpected trailing data.");
  }

  return contractAddress(0, stateInit).toRawString().toLowerCase();
}

/**
 * Compare addresses using TON's canonical raw representation. Invalid
 * addresses fail closed and return false.
 */
export function stateInitMatchesAddress(
  stateInitBocBase64: unknown,
  claimedAddress: unknown,
): boolean {
  if (typeof claimedAddress !== "string") return false;

  try {
    const derived = deriveAddressFromStateInitBoc(stateInitBocBase64);
    return Address.parse(claimedAddress).toRawString().toLowerCase() === derived;
  } catch {
    return false;
  }
}
