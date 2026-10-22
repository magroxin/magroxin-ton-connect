export interface TonPriceQuote {
  source: string;
  priceUsd: number;
  timestampMs: number;
}

export const MAX_QUOTE_AGE_MS = 120_000;
export const MAX_FUTURE_SKEW_MS = 30_000;
export const MAX_SOURCE_DEVIATION = 0.05;

export function parseBinanceQuote(value: unknown, nowMs = Date.now()): TonPriceQuote | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const priceUsd = Number(data.price);
  const timestampMs = Number(data.closeTime);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || !Number.isFinite(timestampMs)) return null;
  if (timestampMs > nowMs + MAX_FUTURE_SKEW_MS || nowMs - timestampMs > MAX_QUOTE_AGE_MS) return null;
  return { source: "binance", priceUsd, timestampMs };
}

export function parseCoinGeckoQuote(value: unknown, nowMs = Date.now()): TonPriceQuote | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const ton = data["the-open-network"];
  if (!ton || typeof ton !== "object") return null;
  const record = ton as Record<string, unknown>;
  const priceUsd = Number(record.usd);
  const timestampMs = Number(record.last_updated_at) * 1000;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || !Number.isFinite(timestampMs)) return null;
  if (timestampMs > nowMs + MAX_FUTURE_SKEW_MS || nowMs - timestampMs > MAX_QUOTE_AGE_MS) return null;
  return { source: "coingecko", priceUsd, timestampMs };
}

export function selectTonUsdPrice(quotes: TonPriceQuote[]): number {
  if (quotes.length === 0) throw new Error("No fresh TON/USD quotes are available.");
  const prices = quotes.map((quote) => quote.priceUsd);
  if (prices.some((price) => !Number.isFinite(price) || price <= 0)) {
    throw new Error("Invalid TON/USD quote.");
  }
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  if (prices.length > 1 && (highest - lowest) / ((highest + lowest) / 2) > MAX_SOURCE_DEVIATION) {
    throw new Error("TON/USD price sources disagree beyond the allowed threshold.");
  }
  // Use the highest agreeing price to avoid under-quoting the USD service fee.
  return highest;
}
