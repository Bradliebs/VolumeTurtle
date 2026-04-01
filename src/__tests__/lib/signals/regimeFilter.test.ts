jest.mock("@/lib/config", () => require("../../__mocks__/config"));

import {
  calculateTickerRegime,
  assessRegime,
} from "@/lib/signals/regimeFilter";
import type { RegimeState, TickerRegime } from "@/lib/signals/regimeFilter";
import { generateQuotes, makeQuote } from "../../helpers";
import type { DailyQuote } from "@/lib/data/fetchQuotes";

describe("calculateTickerRegime", () => {
  it("returns UPTREND when close > 50-day MA", () => {
    // 50+ quotes, close consistently at 100
    const quotes = generateQuotes(55, { basePrice: 100, spread: 1 });
    // Push close higher on last day
    quotes[quotes.length - 1]!.close = 110;
    const result = calculateTickerRegime("TEST", quotes);
    expect(result.tickerTrend).toBe("UPTREND");
    expect(result.pctAboveMA50).toBeGreaterThan(0);
  });

  it("returns DOWNTREND when close < 50-day MA", () => {
    const quotes = generateQuotes(55, { basePrice: 100, spread: 1 });
    quotes[quotes.length - 1]!.close = 80;
    const result = calculateTickerRegime("TEST", quotes);
    expect(result.tickerTrend).toBe("DOWNTREND");
    expect(result.pctAboveMA50!).toBeLessThan(0);
  });

  it("returns INSUFFICIENT_DATA when fewer than 30 quotes", () => {
    const quotes = generateQuotes(20);
    const result = calculateTickerRegime("TEST", quotes);
    expect(result.tickerTrend).toBe("INSUFFICIENT_DATA");
    expect(result.ma50).toBeNull();
    expect(result.pctAboveMA50).toBeNull();
  });

  it("uses adaptive MA period with 30-49 quotes", () => {
    const quotes = generateQuotes(35);
    const result = calculateTickerRegime("TEST", quotes);
    expect(result.tickerTrend).not.toBe("INSUFFICIENT_DATA");
    expect(result.maPeriod).toBe(35);
  });

  it("handles empty quotes", () => {
    const result = calculateTickerRegime("TEST", []);
    expect(result.tickerTrend).toBe("INSUFFICIENT_DATA");
    expect(result.close).toBe(0);
  });
});

describe("assessRegime", () => {
  function makeRegime(overrides: Partial<RegimeState> = {}): RegimeState {
    return {
      marketRegime: "BULLISH",
      qqqClose: 400,
      qqq200MA: 380,
      qqqPctAboveMA: 5.26,
      volatilityRegime: "NORMAL",
      vixLevel: 15,
      asOf: "2025-01-01",
      fetchedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function makeTickerRegime(overrides: Partial<TickerRegime> = {}): TickerRegime {
    return {
      ticker: "TEST",
      tickerTrend: "UPTREND",
      close: 100,
      ma50: 95,
      pctAboveMA50: 5.26,
      maPeriod: 50,
      ...overrides,
    };
  }

  it("returns STRONG (score=3) when all layers green", () => {
    const result = assessRegime(
      makeRegime({ marketRegime: "BULLISH", volatilityRegime: "NORMAL" }),
      makeTickerRegime({ tickerTrend: "UPTREND" }),
    );
    expect(result.overallSignal).toBe("STRONG");
    expect(result.score).toBe(3);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns CAUTION (score=2) when one layer is red", () => {
    const result = assessRegime(
      makeRegime({ marketRegime: "BEARISH", volatilityRegime: "NORMAL" }),
      makeTickerRegime({ tickerTrend: "UPTREND" }),
    );
    expect(result.overallSignal).toBe("CAUTION");
    expect(result.score).toBe(2);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns AVOID (score<=1) when multiple layers red", () => {
    const result = assessRegime(
      makeRegime({ marketRegime: "BEARISH", volatilityRegime: "PANIC", vixLevel: 40 }),
      makeTickerRegime({ tickerTrend: "DOWNTREND", pctAboveMA50: -10 }),
    );
    expect(result.overallSignal).toBe("AVOID");
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("adds BEARISH warning with QQQ below MA info", () => {
    const result = assessRegime(
      makeRegime({ marketRegime: "BEARISH", qqqPctAboveMA: -5 }),
      makeTickerRegime(),
    );
    expect(result.warnings.some(w => w.includes("BEARISH"))).toBe(true);
  });

  it("adds ELEVATED VIX warning", () => {
    const result = assessRegime(
      makeRegime({ volatilityRegime: "ELEVATED", vixLevel: 30 }),
      makeTickerRegime(),
    );
    expect(result.warnings.some(w => w.includes("VIX elevated"))).toBe(true);
  });

  it("adds PANIC VIX warning", () => {
    const result = assessRegime(
      makeRegime({ volatilityRegime: "PANIC", vixLevel: 40 }),
      makeTickerRegime(),
    );
    expect(result.warnings.some(w => w.includes("PANIC"))).toBe(true);
  });

  it("adds downtrend warning for ticker", () => {
    const result = assessRegime(
      makeRegime(),
      makeTickerRegime({ tickerTrend: "DOWNTREND", pctAboveMA50: -8 }),
    );
    expect(result.warnings.some(w => w.includes("below 50-day MA"))).toBe(true);
  });

  it("does NOT add warning for INSUFFICIENT_DATA ticker", () => {
    const result = assessRegime(
      makeRegime(),
      makeTickerRegime({ tickerTrend: "INSUFFICIENT_DATA" }),
    );
    // INSUFFICIENT_DATA doesn't add score, but also no downtrend warning
    expect(result.warnings.every(w => !w.includes("below 50-day MA"))).toBe(true);
  });
});
