jest.mock("@/lib/config", () => require("../../__mocks__/config"));

import {
  calculateTrailingLow,
  shouldExit,
  updateTrailingStop,
} from "@/lib/signals/exitSignal";
import type { OpenPosition } from "@/lib/signals/exitSignal";
import { makeQuote } from "../../helpers";
import type { DailyQuote } from "@/lib/data/fetchQuotes";

function buildTrailingQuotes(closes: number[]): DailyQuote[] {
  return closes.map((close, i) =>
    makeQuote({
      date: `2025-01-${String(i + 1).padStart(2, "0")}`,
      open: close - 1,
      high: close + 2,
      low: close - 2,
      close,
    }),
  );
}

describe("calculateTrailingLow", () => {
  it("returns the lowest close in the trailing window, excluding today", () => {
    // config.trailingStopDays = 10
    // Build 11 quotes (10 window + 1 today)
    const closes = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 105];
    const quotes = buildTrailingQuotes(closes);
    // Window is indices 0..9 (closes 100..91), today is index 10 (105)
    expect(calculateTrailingLow(quotes)).toBe(91);
  });

  it("returns -Infinity for empty quotes", () => {
    expect(calculateTrailingLow([])).toBe(-Infinity);
  });

  it("handles fewer quotes than trailing window", () => {
    const closes = [100, 95, 110];
    const quotes = buildTrailingQuotes(closes);
    // Window: slice(-(10+1), -1) → may have only 2 items
    const low = calculateTrailingLow(quotes);
    expect(low).toBe(95);
  });
});

describe("shouldExit", () => {
  it("returns true when currentClose < trailing low", () => {
    const closes = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 100];
    const quotes = buildTrailingQuotes(closes);
    expect(shouldExit(90, quotes)).toBe(true);
  });

  it("returns false when currentClose >= trailing low", () => {
    const closes = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 100];
    const quotes = buildTrailingQuotes(closes);
    expect(shouldExit(95, quotes)).toBe(false);
  });

  it("returns false when currentClose equals trailing low", () => {
    const closes = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 100];
    const quotes = buildTrailingQuotes(closes);
    expect(shouldExit(91, quotes)).toBe(false);
  });
});

describe("updateTrailingStop", () => {
  it("ratchets up when new 10-day low is higher", () => {
    const position: OpenPosition = {
      ticker: "TEST",
      entryDate: "2025-01-01",
      entryPrice: 100,
      shares: 10,
      hardStop: 80,
      trailingStop: 90,
      currentStop: 90,
    };
    // All closes above 90 → new trailing low = 95
    const closes = [100, 99, 98, 97, 96, 95, 96, 97, 98, 99, 105];
    const quotes = buildTrailingQuotes(closes);
    expect(updateTrailingStop(position, quotes)).toBe(95);
  });

  it("does NOT ratchet down when new low is lower", () => {
    const position: OpenPosition = {
      ticker: "TEST",
      entryDate: "2025-01-01",
      entryPrice: 100,
      shares: 10,
      hardStop: 80,
      trailingStop: 95,
      currentStop: 95,
    };
    // Some closes below 95 → new trailing low = 85
    const closes = [90, 88, 85, 87, 89, 91, 93, 92, 91, 90, 100];
    const quotes = buildTrailingQuotes(closes);
    // Should keep 95 (current stop), not go down to 85
    expect(updateTrailingStop(position, quotes)).toBe(95);
  });

  it("stays the same when new low equals current stop", () => {
    const position: OpenPosition = {
      ticker: "TEST",
      entryDate: "2025-01-01",
      entryPrice: 100,
      shares: 10,
      hardStop: 80,
      trailingStop: 92,
      currentStop: 92,
    };
    const closes = [100, 99, 98, 97, 96, 95, 94, 93, 92, 95, 100];
    const quotes = buildTrailingQuotes(closes);
    expect(updateTrailingStop(position, quotes)).toBe(92);
  });
});
