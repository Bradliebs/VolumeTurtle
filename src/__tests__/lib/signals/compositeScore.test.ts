jest.mock("@/lib/config", () => require("../../__mocks__/config"));

import { calculateCompositeScore } from "@/lib/signals/compositeScore";
import type { RegimeAssessment, RegimeState, TickerRegime } from "@/lib/signals/regimeFilter";

function makeRegimeAssessment(overrides: Partial<{
  score: number;
  pctAboveMA50: number | null;
  overallSignal: string;
}>): RegimeAssessment {
  const regime: RegimeState = {
    marketRegime: "BULLISH",
    qqqClose: 400,
    qqq200MA: 380,
    qqqPctAboveMA: 5.26,
    volatilityRegime: "NORMAL",
    vixLevel: 15,
    asOf: "2025-01-01",
    fetchedAt: new Date().toISOString(),
  };

  const tickerRegime: TickerRegime = {
    ticker: "TEST",
    tickerTrend: "UPTREND",
    close: 100,
    ma50: 95,
    pctAboveMA50: overrides.pctAboveMA50 ?? 5.26,
    maPeriod: 50,
  };

  return {
    regime,
    tickerRegime,
    overallSignal: (overrides.overallSignal ?? "STRONG") as RegimeAssessment["overallSignal"],
    warnings: [],
    score: overrides.score ?? 3,
    breadth: null,
  };
}

describe("calculateCompositeScore", () => {
  it("returns a score between 0 and 1", () => {
    const assessment = makeRegimeAssessment({ score: 3 });
    const result = calculateCompositeScore(assessment, 3.0, 5_000_000);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(1);
  });

  it("returns grade A for optimal conditions", () => {
    const assessment = makeRegimeAssessment({ score: 3, pctAboveMA50: 25 });
    const result = calculateCompositeScore(assessment, 5.0, 10_000_000);
    expect(result.grade).toBe("A");
    expect(result.total).toBeGreaterThanOrEqual(0.75);
  });

  it("returns grade D for poor conditions", () => {
    const assessment = makeRegimeAssessment({ score: 0, pctAboveMA50: -20 });
    const result = calculateCompositeScore(assessment, 2.0, 100_000);
    expect(result.grade).toBe("D");
    expect(result.total).toBeLessThan(0.35);
  });

  it("handles null regime assessment", () => {
    const result = calculateCompositeScore(null, 3.0, 5_000_000);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(1);
    // Regime defaults to 0.5, trend defaults to 0.5
  });

  it("caps volume ratio at 5x", () => {
    const assessment = makeRegimeAssessment({ score: 3 });
    const at5x = calculateCompositeScore(assessment, 5.0, 5_000_000);
    const at10x = calculateCompositeScore(assessment, 10.0, 5_000_000);
    expect(at5x.components.volumeScore).toBe(at10x.components.volumeScore);
  });

  it("volume score is 0 for exactly 2x ratio", () => {
    const assessment = makeRegimeAssessment({ score: 3 });
    const result = calculateCompositeScore(assessment, 2.0, 5_000_000);
    expect(result.components.volumeScore).toBe(0);
  });

  it("assigns correct liquidity tiers", () => {
    const assessment = makeRegimeAssessment({ score: 3, pctAboveMA50: 5 });

    const highLiq = calculateCompositeScore(assessment, 3.0, 5_000_000);
    const medLiq = calculateCompositeScore(assessment, 3.0, 2_000_000);
    const lowLiq = calculateCompositeScore(assessment, 3.0, 1_000_000);
    const veryLow = calculateCompositeScore(assessment, 3.0, 500_000);

    expect(highLiq.components.liquidityScore).toBeGreaterThan(medLiq.components.liquidityScore);
    expect(medLiq.components.liquidityScore).toBeGreaterThan(lowLiq.components.liquidityScore);
    expect(lowLiq.components.liquidityScore).toBeGreaterThan(veryLow.components.liquidityScore);
  });

  it("trend scoring follows pctAboveMA50 tiers", () => {
    const above20 = calculateCompositeScore(makeRegimeAssessment({ score: 3, pctAboveMA50: 25 }), 3, 5e6);
    const above10 = calculateCompositeScore(makeRegimeAssessment({ score: 3, pctAboveMA50: 15 }), 3, 5e6);
    const above0 = calculateCompositeScore(makeRegimeAssessment({ score: 3, pctAboveMA50: 5 }), 3, 5e6);
    const belowNeg5 = calculateCompositeScore(makeRegimeAssessment({ score: 3, pctAboveMA50: -10 }), 3, 5e6);
    const belowNeg15 = calculateCompositeScore(makeRegimeAssessment({ score: 3, pctAboveMA50: -20 }), 3, 5e6);

    expect(above20.components.trendScore).toBeGreaterThan(above10.components.trendScore);
    expect(above10.components.trendScore).toBeGreaterThan(above0.components.trendScore);
    expect(above0.components.trendScore).toBeGreaterThan(belowNeg5.components.trendScore);
    expect(belowNeg5.components.trendScore).toBeGreaterThan(belowNeg15.components.trendScore);
  });

  it("provides meaningful grade reasons", () => {
    const resultA = calculateCompositeScore(makeRegimeAssessment({ score: 3, pctAboveMA50: 25 }), 5, 10e6);
    const resultD = calculateCompositeScore(makeRegimeAssessment({ score: 0, pctAboveMA50: -20 }), 2, 100_000);

    expect(resultA.gradeReason).toContain("Strong");
    expect(resultD.gradeReason).toContain("Weak");
  });
});
