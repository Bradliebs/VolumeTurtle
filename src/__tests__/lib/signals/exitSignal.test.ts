jest.mock("@/lib/config", () => require("../../__mocks__/config"));

import {
  calculateTrailingLow,
  shouldExit,
  updateTrailingStop,
  findHighestCloseSinceEntry,
  calculateLadderStop,
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

  it("returns null for empty quotes", () => {
    expect(calculateTrailingLow([])).toBeNull();
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

describe("findHighestCloseSinceEntry", () => {
  it("returns the highest close on or after entry date", () => {
    const quotes = buildTrailingQuotes([100, 105, 103, 110, 108]);
    expect(findHighestCloseSinceEntry("2025-01-01", quotes)).toBe(110);
  });

  it("only considers quotes from entry date forward", () => {
    const quotes = buildTrailingQuotes([200, 100, 105, 103]);
    // entry on day 2, so day 1 (200) is excluded
    expect(findHighestCloseSinceEntry("2025-01-02", quotes)).toBe(105);
  });

  it("returns null when no quotes match", () => {
    const quotes = buildTrailingQuotes([100, 105]);
    expect(findHighestCloseSinceEntry("2025-12-01", quotes)).toBeNull();
  });

  it("returns null for empty quotes", () => {
    expect(findHighestCloseSinceEntry("2025-01-01", [])).toBeNull();
  });
});

describe("calculateLadderStop — R-multiple ratchet", () => {
  // Standard position: entry 100, hard stop 90, risk = 10
  function makePosition(overrides: Partial<OpenPosition> = {}): OpenPosition {
    return {
      ticker: "TEST",
      entryDate: "2025-01-01",
      entryPrice: 100,
      shares: 10,
      hardStop: 90,
      trailingStop: 90,
      currentStop: 90,
      ...overrides,
    };
  }

  it("keeps hardStop when below 1R profit", () => {
    const pos = makePosition();
    // highest close = 105, R = (105-100)/10 = 0.5R → below 1R
    const quotes = buildTrailingQuotes([100, 102, 105, 103]);
    expect(calculateLadderStop(pos, quotes, 5)).toBe(90);
  });

  it("moves to breakeven at 1R profit", () => {
    const pos = makePosition();
    // highest close = 110, R = (110-100)/10 = 1R → breakeven
    const quotes = buildTrailingQuotes([100, 105, 110, 108]);
    expect(calculateLadderStop(pos, quotes, 5)).toBe(100); // entry price
  });

  it("locks 1R at 2R profit", () => {
    const pos = makePosition();
    // highest close = 120, R = (120-100)/10 = 2R → lock 1R
    const quotes = buildTrailingQuotes([100, 110, 120, 118]);
    expect(calculateLadderStop(pos, quotes, 5)).toBe(110); // entry + riskPerShare
  });

  it("ATR trails at 3R+ profit", () => {
    const pos = makePosition();
    // highest close = 130, R = (130-100)/10 = 3R → ATR trail
    // atr = 5, trailMultiplier = 2.0, so stop = 130 - (5 * 2) = 120
    // 1R lock = 110, so max(110, 120) = 120
    const quotes = buildTrailingQuotes([100, 110, 120, 130, 128]);
    expect(calculateLadderStop(pos, quotes, 5)).toBe(120);
  });

  it("ATR trail is floored at 1R lock", () => {
    const pos = makePosition();
    // highest close = 130, R = 3R, atr = 15
    // atrTrail = 130 - (15 * 2) = 100
    // 1R lock = 110, so max(110, 100) = 110
    const quotes = buildTrailingQuotes([100, 110, 120, 130, 125]);
    expect(calculateLadderStop(pos, quotes, 15)).toBe(110);
  });

  it("monotonic: never returns below current trailing stop", () => {
    // Position already at breakeven (100), price drops but highest close was 110
    const pos = makePosition({ trailingStop: 100, currentStop: 100 });
    // Even though R from highest close = 1R → ladder says 100 (breakeven)
    // trailingStop already at 100, so stays at 100
    const quotes = buildTrailingQuotes([100, 105, 110, 95]);
    expect(calculateLadderStop(pos, quotes, 5)).toBe(100);
  });

  it("monotonic: stop cannot decrease even if ATR expands", () => {
    // Position at 120 stop (from prior ATR trail)
    const pos = makePosition({ trailingStop: 120, currentStop: 120 });
    // highest close = 135, R = 3.5R, atr expanded to 10
    // atrTrail = 135 - (10 * 2) = 115 → BELOW current stop of 120
    // monotonic constraint holds: max(120, 115) = 120
    const quotes = buildTrailingQuotes([100, 110, 120, 130, 135, 132]);
    expect(calculateLadderStop(pos, quotes, 10)).toBe(120);
  });

  it("stop ratchets up through all stages", () => {
    const quotes = buildTrailingQuotes([100, 105, 110, 115, 120, 125, 130, 135]);
    const atr = 5;

    // Stage 1: below 1R (highest=105, R=0.5)
    let pos = makePosition();
    let stop = calculateLadderStop(pos, quotes.slice(0, 2), atr);
    expect(stop).toBe(90); // hardStop

    // Stage 2: at 1R (highest=110, R=1)
    pos = { ...pos, trailingStop: stop, currentStop: stop };
    stop = calculateLadderStop(pos, quotes.slice(0, 3), atr);
    expect(stop).toBe(100); // breakeven

    // Stage 3: at 2R (highest=120, R=2)
    pos = { ...pos, trailingStop: stop, currentStop: stop };
    stop = calculateLadderStop(pos, quotes.slice(0, 5), atr);
    expect(stop).toBe(110); // lock 1R

    // Stage 4: at 3R (highest=130, R=3)
    pos = { ...pos, trailingStop: stop, currentStop: stop };
    stop = calculateLadderStop(pos, quotes.slice(0, 7), atr);
    // atrTrail = 130 - (5*2) = 120, vs 1R lock=110 → 120
    expect(stop).toBe(120);

    // Stage 5: at 3.5R (highest=135, R=3.5)
    pos = { ...pos, trailingStop: stop, currentStop: stop };
    stop = calculateLadderStop(pos, quotes.slice(0, 8), atr);
    // atrTrail = 135 - 10 = 125, vs current=120 → 125
    expect(stop).toBe(125);
  });

  it("returns current trailing stop when riskPerShare <= 0", () => {
    const pos = makePosition({ entryPrice: 100, hardStop: 100, trailingStop: 100 });
    const quotes = buildTrailingQuotes([100, 110, 120]);
    expect(calculateLadderStop(pos, quotes, 5)).toBe(100);
  });

  it("returns current trailing stop when no ATR available at 3R+", () => {
    const pos = makePosition();
    // highest close = 130, R = 3R, but no ATR → falls to 2R logic
    const quotes = buildTrailingQuotes([100, 110, 120, 130]);
    // Without ATR, 3R+ branch is skipped → falls to 2R: lock 1R = 110
    expect(calculateLadderStop(pos, quotes, null)).toBe(110);
  });

  it("returns current trailing stop when no quotes since entry", () => {
    const pos = makePosition({ entryDate: "2026-01-01" });
    const quotes = buildTrailingQuotes([100, 105, 110]);
    expect(calculateLadderStop(pos, quotes, 5)).toBe(90);
  });
});

describe("updateTrailingStop", () => {
  it("delegates to calculateLadderStop with ATR", () => {
    const position: OpenPosition = {
      ticker: "TEST",
      entryDate: "2025-01-01",
      entryPrice: 100,
      shares: 10,
      hardStop: 90,
      trailingStop: 90,
      currentStop: 90,
    };
    // highest close = 110, R = 1 → breakeven at 100
    const quotes = buildTrailingQuotes([100, 105, 110, 108]);
    expect(updateTrailingStop(position, quotes, 5)).toBe(100);
  });

  it("works without ATR parameter (backward compat)", () => {
    const position: OpenPosition = {
      ticker: "TEST",
      entryDate: "2025-01-01",
      entryPrice: 100,
      shares: 10,
      hardStop: 90,
      trailingStop: 90,
      currentStop: 90,
    };
    const quotes = buildTrailingQuotes([100, 105, 110, 108]);
    // No ATR → still applies R-ladder (1R → breakeven)
    expect(updateTrailingStop(position, quotes)).toBe(100);
  });

  it("never decreases from current trailing stop", () => {
    const position: OpenPosition = {
      ticker: "TEST",
      entryDate: "2025-01-01",
      entryPrice: 100,
      shares: 10,
      hardStop: 80,
      trailingStop: 95,
      currentStop: 95,
    };
    // All closes below 95 → ladder wouldn't push above 95
    const closes = [90, 88, 85, 87, 89, 91, 93, 92, 91, 90, 100];
    const quotes = buildTrailingQuotes(closes);
    // highest close = 100, R = (100-100)/20 = 0R → ladder says 80 (hardStop)
    // monotonic: max(95, 80) = 95
    expect(updateTrailingStop(position, quotes, 5)).toBe(95);
  });
});
