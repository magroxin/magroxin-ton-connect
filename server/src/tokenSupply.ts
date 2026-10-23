export const MAX_JETTON_SUPPLY_UNITS = 10n ** 30n;

export function isSupportedJettonSupply(
  supply: string,
  decimals: number,
): boolean {
  if (!/^[1-9]\d*$/.test(supply)) return false;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) return false;

  try {
    return BigInt(supply) * 10n ** BigInt(decimals) <= MAX_JETTON_SUPPLY_UNITS;
  } catch {
    return false;
  }
}
