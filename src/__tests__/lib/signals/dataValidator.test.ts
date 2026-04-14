/**
 * Data validator — tests for blocking flags, warnings, and edge cases.
 */

jest.mock("@/lib/config", () => require("../../__mocks__/config"));

jest.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock("@/lib/data/crossValidator", () => ({
  crossValidateMove: jest.fn().mockResolvedValue({ confirmed: false, source: "mock" }),
}));

import { validateTicker, type Candle } from "@/lib/signals/dataValidator";

function makeCandles(n: number, opts: { flat?: boolean; close?: number; volume?: number } = {}): Candle[] {
  const { flat = false, close = 100, volume = 500_000 } = opts;
  const candles: Candle[] = [];
  // Start from recent dates to avoid STALE_DATA flag
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - n);
  for (let i = 0; i < n; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    // Skip weekends
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    const c = flat ? close : close + (i % 3) - 1;
    candles.push({
      date: d.toISOString().slice(0, 10),
      open: c - 1,
      high: flat ? c : c + 2,
      low: flat ? c : c - 2,
      close: c,
      volume,
    });
  }
  return candles;
}

describe("validateTicker", () => {
  it("blocks ticker with insufficient history", async () => {
    const candles = makeCandles(3);
    const result = await validateTicker("TEST", candles, null);
    expect(result.valid).toBe(false);
    expect(result.flags.some((f) => f.includes("INSUFFICIENT_HISTORY"))).toBe(true);
  });

  it("passes clean ticker with sufficient history", async () => {
    const candles = makeCandles(25);
    const result = await validateTicker("TEST", candles, null);
    expect(result.valid).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it("blocks ZERO_VOLUME when today has no volume", async () => {
    const candles = makeCandles(25);
    candles[candles.length - 1]!.volume = 0;
    const result = await validateTicker("TEST", candles, null);
    expect(result.valid).toBe(false);
    expect(result.flags.some((f) => f.includes("ZERO_VOLUME"))).toBe(true);
  });

  it("blocks PRICE_ANOMALY when close is outside high/low", async () => {
    const candles = makeCandles(25);
    candles[candles.length - 1]!.close = 200; // way above high
    const result = await validateTicker("TEST", candles, null);
    expect(result.valid).toBe(false);
    expect(result.flags.some((f) => f.includes("PRICE_ANOMALY"))).toBe(true);
  });

  it("blocks SPLIT_SUSPECTED on large move with low volume", async () => {
    const candles = makeCandles(25);
    // Set yesterday's close to 100, today's close to 150 (50% move) with very low volume ratio
    candles[candles.length - 2]!.close = 100;
    candles[candles.length - 1]!.close = 150;
    candles[candles.length - 1]!.high = 155;
    candles[candles.length - 1]!.low = 148;
    candles[candles.length - 1]!.volume = 100; // extremely low relative volume
    const result = await validateTicker("TEST", candles, null);
    expect(result.valid).toBe(false);
    expect(result.flags.some((f) => f.includes("SPLIT_SUSPECTED"))).toBe(true);
  });

  it("flags ZERO_ATR when price history is perfectly flat", async () => {
    const candles = makeCandles(25, { flat: true, close: 50, volume: 1000 });
    const result = await validateTicker("TEST", candles, null);
    expect(result.valid).toBe(false);
    expect(result.flags.some((f) => f.includes("ZERO_ATR"))).toBe(true);
  });

  it("does not flag ZERO_ATR for normal price data", async () => {
    const candles = makeCandles(25);
    const result = await validateTicker("TEST", candles, null);
    expect(result.flags.some((f) => f.includes("ZERO_ATR"))).toBe(false);
  });

  it("warns on HIGH_MOVE within threshold", async () => {
    const candles = makeCandles(25);
    candles[candles.length - 2]!.close = 100;
    candles[candles.length - 1]!.close = 118; // 18% move — above 15% warning, below 25% extreme
    candles[candles.length - 1]!.high = 120;
    candles[candles.length - 1]!.low = 115;
    const result = await validateTicker("TEST", candles, null);
    expect(result.warnings.some((w) => w.includes("HIGH_MOVE"))).toBe(true);
  });

  it("warns on extreme volume spike", async () => {
    const candles = makeCandles(25);
    candles[candles.length - 1]!.volume = 100_000_000; // 200x average
    const result = await validateTicker("TEST", candles, null);
    expect(result.warnings.some((w) => w.includes("VOLUME_SPIKE"))).toBe(true);
  });
});
