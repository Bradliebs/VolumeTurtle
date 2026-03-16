jest.mock("@/lib/config", () => require("../../__mocks__/config"));

import { calculatePositionSize, checkMaxPositions } from "@/lib/risk/positionSizer";
import type { VolumeSignal } from "@/lib/signals/volumeSignal";
import type { EquityCurveState } from "@/lib/risk/equityCurve";

function makeSignal(overrides: Partial<VolumeSignal> = {}): VolumeSignal {
  return {
    ticker: "TEST",
    date: "2025-01-15",
    close: 100,
    volume: 3000,
    avgVolume20: 1000,
    volumeRatio: 3.0,
    rangePosition: 0.9,
    atr20: 5.0,
    suggestedEntry: 100,
    hardStop: 90,
    riskPerShare: 10,
    regimeAssessment: null,
    compositeScore: null,
    avgDollarVolume20: 5_000_000,
    ...overrides,
  };
}

describe("calculatePositionSize", () => {
  it("calculates correct shares based on 2% risk", () => {
    const signal = makeSignal({ riskPerShare: 10, suggestedEntry: 100 });
    const result = calculatePositionSize(signal, 10000);
    expect(result).not.toBeNull();
    // dollarRisk = 10000 * 0.02 = 200, shares = 200 / 10 = 20
    expect(result!.dollarRisk).toBe(200);
    expect(result!.shares).toBe(20);
    expect(result!.totalExposure).toBe(2000);
  });

  it("supports fractional shares", () => {
    const signal = makeSignal({ riskPerShare: 7, suggestedEntry: 100 });
    const result = calculatePositionSize(signal, 10000);
    expect(result).not.toBeNull();
    // dollarRisk = 200, shares = 200/7 ≈ 28.5714
    expect(result!.shares).toBeCloseTo(28.5714, 3);
  });

  it("returns null when total exposure < £1", () => {
    // Very high riskPerShare → tiny position
    const signal = makeSignal({ riskPerShare: 1000, suggestedEntry: 0.01 });
    const result = calculatePositionSize(signal, 10000);
    // dollarRisk = 200, shares = 200/1000 = 0.2, exposure = 0.2 * 0.01 = 0.002
    expect(result).toBeNull();
  });

  it("returns null when equity curve is PAUSE", () => {
    const signal = makeSignal();
    const pauseState: EquityCurveState = {
      currentBalance: 8000,
      peakBalance: 10000,
      drawdownPct: 20,
      drawdownAbs: 2000,
      equityMA20: null,
      aboveEquityMA: false,
      systemState: "PAUSE",
      riskMultiplier: 0,
      maxPositions: 0,
      riskPctPerTrade: 0,
      reason: "Paused",
      triggeredAt: null,
    };
    expect(calculatePositionSize(signal, 10000, pauseState)).toBeNull();
  });

  it("uses reduced risk in CAUTION state", () => {
    const signal = makeSignal({ riskPerShare: 10 });
    const cautionState: EquityCurveState = {
      currentBalance: 9000,
      peakBalance: 10000,
      drawdownPct: 10,
      drawdownAbs: 1000,
      equityMA20: null,
      aboveEquityMA: true,
      systemState: "CAUTION",
      riskMultiplier: 0.5,
      maxPositions: 3,
      riskPctPerTrade: 1.0, // 1% instead of 2%
      reason: "Reduced risk",
      triggeredAt: null,
    };
    const result = calculatePositionSize(signal, 10000, cautionState);
    expect(result).not.toBeNull();
    // effectiveRiskPct = 1.0/100 = 0.01, dollarRisk = 10000 * 0.01 = 100
    expect(result!.dollarRisk).toBe(100);
    expect(result!.shares).toBe(10);
  });

  it("warns when exposure exceeds 25%", () => {
    // Low riskPerShare → large position → high exposure
    const signal = makeSignal({ riskPerShare: 0.5, suggestedEntry: 100 });
    const result = calculatePositionSize(signal, 1000);
    expect(result).not.toBeNull();
    // dollarRisk = 1000 * 0.02 = 20, shares = 20/0.5 = 40, exposure = 40*100 = 4000 = 400% !!!
    expect(result!.exposureWarning).not.toBeNull();
    expect(result!.exposureWarning!).toContain("HIGH EXPOSURE");
  });

  it("does not warn when exposure is under 25%", () => {
    const signal = makeSignal({ riskPerShare: 10, suggestedEntry: 100 });
    const result = calculatePositionSize(signal, 10000);
    // exposure = 20 * 100 = 2000 / 10000 = 20%
    expect(result!.exposureWarning).toBeNull();
  });
});

describe("checkMaxPositions", () => {
  it("returns true when below max", () => {
    expect(checkMaxPositions(3, 5)).toBe(true);
  });

  it("returns false when at max", () => {
    expect(checkMaxPositions(5, 5)).toBe(false);
  });

  it("returns false when above max", () => {
    expect(checkMaxPositions(6, 5)).toBe(false);
  });

  it("uses config default when maxAllowed not specified", () => {
    // config.maxPositions = 5
    expect(checkMaxPositions(4)).toBe(true);
    expect(checkMaxPositions(5)).toBe(false);
  });
});
