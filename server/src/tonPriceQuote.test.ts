import test from "node:test";
import assert from "node:assert/strict";
import { parseBinanceQuote, parseCoinGeckoQuote, selectTonUsdPrice } from "./tonPriceQuote.js";

const now = 1_800_000_000_000;

test("accepts fresh Binance 24-hour ticker quote", () => {
  assert.deepEqual(parseBinanceQuote({ price: "3.25", closeTime: now - 10_000 }, now), {
    source: "binance", priceUsd: 3.25, timestampMs: now - 10_000,
  });
});

test("rejects stale, future-dated, malformed, and non-positive Binance quotes", () => {
  assert.equal(parseBinanceQuote({ price: "3", closeTime: now - 121_000 }, now), null);
  assert.equal(parseBinanceQuote({ price: "3", closeTime: now + 31_000 }, now), null);
  assert.equal(parseBinanceQuote({ price: "0", closeTime: now }, now), null);
  assert.equal(parseBinanceQuote({ price: "bad", closeTime: now }, now), null);
  assert.equal(parseBinanceQuote({ price: "3" }, now), null);
});

test("accepts quotes exactly at the maximum age and future-skew boundaries", () => {
  assert.notEqual(parseBinanceQuote({ price: "3", closeTime: now - 120_000 }, now), null);
  assert.notEqual(parseBinanceQuote({ price: "3", closeTime: now + 30_000 }, now), null);
});

test("accepts fresh CoinGecko quote with last_updated_at", () => {
  assert.deepEqual(parseCoinGeckoQuote({ "the-open-network": { usd: 3.5, last_updated_at: (now - 5_000) / 1000 } }, now), {
    source: "coingecko", priceUsd: 3.5, timestampMs: now - 5_000,
  });
});

test("rejects stale or missing CoinGecko timestamps", () => {
  assert.equal(parseCoinGeckoQuote({ "the-open-network": { usd: 3.5, last_updated_at: (now - 200_000) / 1000 } }, now), null);
  assert.equal(parseCoinGeckoQuote({ "the-open-network": { usd: 3.5 } }, now), null);
});

test("uses the highest price when sources agree within five percent", () => {
  assert.equal(selectTonUsdPrice([
    { source: "a", priceUsd: 3.2, timestampMs: now },
    { source: "b", priceUsd: 3.3, timestampMs: now },
  ]), 3.3);
});

test("accepts source prices exactly at the five-percent disagreement boundary", () => {
  assert.equal(selectTonUsdPrice([
    { source: "a", priceUsd: 100, timestampMs: now },
    { source: "b", priceUsd: 105.1, timestampMs: now },
  ]), 105.1);
});

test("rejects price-source disagreement above five percent", () => {
  assert.throws(() => selectTonUsdPrice([
    { source: "a", priceUsd: 3, timestampMs: now },
    { source: "b", priceUsd: 3.5, timestampMs: now },
  ]), /disagree/);
});

test("rejects when no fresh quote is available", () => {
  assert.throws(() => selectTonUsdPrice([]), /No fresh/);
});
