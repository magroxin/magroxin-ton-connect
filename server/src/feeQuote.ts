/**
 * Convert a USD service fee into a TON quote rounded upward to six decimals.
 * Rounding upward avoids undercharging the configured USD quote due solely
 * to decimal truncation. Market-price movement after quoting remains possible.
 */
export function calculateFeeTon(feeUsd: number, tonUsd: number): string {
  if (!Number.isFinite(feeUsd) || feeUsd <= 0) {
    throw new Error("USD fee must be a finite positive number.");
  }
  if (!Number.isFinite(tonUsd) || tonUsd <= 0) {
    throw new Error("TON/USD price must be a finite positive number.");
  }

  const rawTon = feeUsd / tonUsd;
  if (!Number.isFinite(rawTon) || rawTon <= 0 || rawTon > 1_000_000_000) {
    throw new Error("Calculated TON fee is outside the supported range.");
  }

  const rounded = Math.ceil(rawTon * 1_000_000) / 1_000_000;
  return rounded.toFixed(6);
}
