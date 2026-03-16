jest.mock("@/lib/config", () => require("../../__mocks__/config"));

import {
  calculateAverageVolume,
  isVolumeSpike,
  isPriceConfirmed,
  generateSignal,
} from "@/lib/signals/volumeSignal";
import { generateQuotes, makeQuote } from "../../helpers";
import type { DailyQuote } from "@/lib/data/fetchQuotes";

// Mock regimeFilter to avoid Yahoo Finance calls
jest.mock("@/lib/signals/regimeFilter", () => ({
  calculateTickerRegime: jest.fn(() => ({
    ticker: "TEST",
    tickerTrend: "UPTREND",
    close: 100,
    ma50: 95,
    pctAboveMA50: 5.26,
  })),
  assessRegime: jest.fn(() => ({
    regime: {},
    tickerRegime: {},
    overallSignal: "STRONG",
    warnings: [],
    score: 3,
  })),
}));

describe("calculateAverageVolume", () => {
  it("excludes the last day and averages the previous N", () => {
    const quotes: DailyQuote[] = [];
    // 21 days: 20 days with volume 1000, then today with volume 5000
    for (let i = 0; i < 20; i++) {
      quotes.push(makeQuote({ date: `2025-01-${String(i + 1).padStart(2, "0")}`, volume: 1000 }));
    }
    quotes.push(makeQuote({ date: "2025-01-21", volume: 5000 }));

    expect(calculateAverageVolume(quotes, 20)).toBe(1000);
  });

  it("returns 0 for empty quotes", () => {
    expect(calculateAverageVolume([], 20)).toBe(0);
  });

  it("handles fewer quotes than period", () => {
    const quotes = generateQuotes(5, { baseVolume: 500 });
    const avg = calculateAverageVolume(quotes, 20);
    // Should still compute from available data (4 days, excluding last)
    expect(avg).toBeGreaterThan(0);
  });
});

describe("isVolumeSpike", () => {
  it("returns true when today volume >= 2x average", () => {
    const quotes: DailyQuote[] = [];
    for (let i = 0; i < 20; i++) {
      quotes.push(makeQuote({
        date: `2025-01-${String(i + 1).padStart(2, "0")}`,
        volume: 1000,
      }));
    }
    // Today: 2x the average
    quotes.push(makeQuote({ date: "2025-01-21", volume: 2000 }));
    expect(isVolumeSpike(quotes)).toBe(true);
  });

  it("returns false when volume is below threshold", () => {
    const quotes: DailyQuote[] = [];
    for (let i = 0; i < 20; i++) {
      quotes.push(makeQuote({
        date: `2025-01-${String(i + 1).padStart(2, "0")}`,
        volume: 1000,
      }));
    }
    quotes.push(makeQuote({ date: "2025-01-21", volume: 1500 }));
    expect(isVolumeSpike(quotes)).toBe(false);
  });

  it("returns false for empty quotes", () => {
    expect(isVolumeSpike([])).toBe(false);
  });
});

describe("isPriceConfirmed", () => {
  it("returns true when close is in top 25% of range", () => {
    // range = 110-90 = 20, close-low = 108-90 = 18, rangePosition = 0.9
    const quote = makeQuote({ date: "2025-01-01", high: 110, low: 90, close: 108 });
    expect(isPriceConfirmed(quote)).toBe(true);
  });

  it("returns false when close is in bottom portion", () => {
    // range = 20, close-low = 92-90 = 2, rangePosition = 0.1
    const quote = makeQuote({ date: "2025-01-01", high: 110, low: 90, close: 92 });
    expect(isPriceConfirmed(quote)).toBe(false);
  });

  it("returns true at exactly the threshold (0.75)", () => {
    // range = 100, close-low = 75, rangePosition = 0.75
    const quote = makeQuote({ date: "2025-01-01", high: 200, low: 100, close: 175 });
    expect(isPriceConfirmed(quote)).toBe(true);
  });

  it("returns false when high equals low (doji)", () => {
    const quote = makeQuote({ date: "2025-01-01", high: 100, low: 100, close: 100 });
    expect(isPriceConfirmed(quote)).toBe(false);
  });
});

describe("generateSignal", () => {
  function buildSignalQuotes(): DailyQuote[] {
    // 21 quotes with low volume, then a spike day
    const quotes: DailyQuote[] = [];
    for (let i = 0; i < 20; i++) {
      quotes.push(makeQuote({
        date: `2025-01-${String(i + 1).padStart(2, "0")}`,
        open: 98,
        high: 105,
        low: 95,
        close: 100,
        volume: 1000,
      }));
    }
    // Spike day: 3x volume + close in top 25% of range
    quotes.push(makeQuote({
      date: "2025-01-21",
      open: 100,
      high: 110,
      low: 90,
      close: 108, // rangePosition = 0.9
      volume: 3000,
    }));
    return quotes;
  }

  it("returns a signal when both conditions met", () => {
    const quotes = buildSignalQuotes();
    const signal = generateSignal("TEST", quotes);
    expect(signal).not.toBeNull();
    expect(signal!.ticker).toBe("TEST");
    expect(signal!.suggestedEntry).toBe(108);
    expect(signal!.volumeRatio).toBe(3.0);
    expect(signal!.hardStop).toBeLessThan(108);
    expect(signal!.riskPerShare).toBeGreaterThan(0);
  });

  it("returns null when volume is not spiking", () => {
    const quotes = buildSignalQuotes();
    // Lower today's volume below threshold
    quotes[quotes.length - 1]!.volume = 1500;
    expect(generateSignal("TEST", quotes)).toBeNull();
  });

  it("returns null when price is not confirmed", () => {
    const quotes = buildSignalQuotes();
    // Move close to bottom of range
    quotes[quotes.length - 1]!.close = 92;
    expect(generateSignal("TEST", quotes)).toBeNull();
  });

  it("returns null for empty quotes", () => {
    expect(generateSignal("TEST", [])).toBeNull();
  });

  it("includes composite score", () => {
    const quotes = buildSignalQuotes();
    const signal = generateSignal("TEST", quotes);
    expect(signal?.compositeScore).toBeDefined();
    expect(signal?.compositeScore?.total).toBeGreaterThanOrEqual(0);
    expect(signal?.compositeScore?.total).toBeLessThanOrEqual(1);
    expect(["A", "B", "C", "D"]).toContain(signal?.compositeScore?.grade);
  });
});
