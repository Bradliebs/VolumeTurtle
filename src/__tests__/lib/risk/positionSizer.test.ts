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
    // atr20=5, config.hardStopAtrMultiple=1.5 → riskPerShare=7.5
    const signal = makeSignal({ atr20: 5, suggestedEntry: 100 });
    const result = calculatePositionSize(signal, 10000);
    expect(result).not.toBeNull();
    // dollarRisk = 10000 * 0.02 = 200, uncapped shares = 200 / 7.5 = 26.6667
    expect(result!.dollarRisk).toBe(200);
    expect(result!.riskPerShare).toBeCloseTo(7.5, 4);
    // exposure = 26.6667 * 100 = 2666.67 > 25% of 10000 → capped to 25 shares
    expect(result!.wasCapped).toBe(true);
    expect(result!.cappedFrom).toBeCloseTo(26.6667, 3);
    expect(result!.shares).toBe(25);
    expect(result!.totalExposure).toBe(2500);
  });

  it("supports fractional shares", () => {
    // atr20=3.5, config.hardStopAtrMultiple=1.5 → riskPerShare=5.25
    const signal = makeSignal({ atr20: 3.5, suggestedEntry: 50 });
    const result = calculatePositionSize(signal, 10000);
    expect(result).not.toBeNull();
    // dollarRisk = 200, shares = 200/5.25 ≈ 38.0952
    expect(result!.shares).toBeCloseTo(38.0952, 3);
    expect(result!.wasCapped).toBe(false);
  });

  it("returns null when total exposure < £1", () => {
    // atr20=5, suggestedEntry=0.01 → riskPerShare=7.5, shares=200/7.5=26.67, exposure=0.2667 < 1
    const signal = makeSignal({ atr20: 5, suggestedEntry: 0.01 });
    const result = calculatePositionSize(signal, 10000);
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
    // atr20=5, config.hardStopAtrMultiple=1.5 → riskPerShare=7.5
    const signal = makeSignal({ atr20: 5, suggestedEntry: 100 });
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
    // shares = 100 / 7.5 = 13.3333
    expect(result!.dollarRisk).toBe(100);
    expect(result!.shares).toBeCloseTo(13.3333, 3);
    expect(result!.wasCapped).toBe(false);
  });

  it("caps exposure at 25% and sets wasCapped", () => {
    // atr20=2, config.hardStopAtrMultiple=1.5 → riskPerShare=3
    // balance=1000, dollarRisk=20, shares=20/3=6.6667
    // exposure=6.6667*100=666.67, 66.7% > 25% → cap to 2.5 shares
    const signal = makeSignal({ atr20: 2, suggestedEntry: 100 });
    const result = calculatePositionSize(signal, 1000);
    expect(result).not.toBeNull();
    expect(result!.wasCapped).toBe(true);
    expect(result!.cappedFrom).toBeCloseTo(6.6667, 3);
    expect(result!.shares).toBe(2.5);
    expect(result!.totalExposure).toBe(250);
    expect(result!.exposurePercent).toBe(0.25);
  });

  it("does not cap when exposure is under 25%", () => {
    // atr20=10, config.hardStopAtrMultiple=1.5 → riskPerShare=15
    // balance=10000, dollarRisk=200, shares=200/15=13.3333
    // exposure=13.3333*100=1333.33, 13.3% < 25%
    const signal = makeSignal({ atr20: 10, suggestedEntry: 100 });
    const result = calculatePositionSize(signal, 10000);
    expect(result!.exposureWarning).toBeNull();
    expect(result!.wasCapped).toBe(false);
    expect(result!.cappedFrom).toBeNull();
  });

  it("returns default VIX fields when no vixLevel provided", () => {
    const signal = makeSignal({ atr20: 10, suggestedEntry: 100 });
    const result = calculatePositionSize(signal, 10000);
    expect(result).not.toBeNull();
    expect(result!.vixLevel).toBe("NORMAL");
    expect(result!.vixMultiplier).toBe(1.0);
  });

  it("reduces shares by 75% in ELEVATED VIX", () => {
    // Normal: riskPct=2%, dollarRisk=200, riskPerShare=15, shares=13.3333
    // Elevated: vixMult=0.75, effectiveRisk=1.5%, dollarRisk=150, shares=10
    const signal = makeSignal({ atr20: 10, suggestedEntry: 100 });
    const result = calculatePositionSize(signal, 10000, undefined, "ELEVATED");
    expect(result).not.toBeNull();
    expect(result!.vixLevel).toBe("ELEVATED");
    expect(result!.vixMultiplier).toBe(0.75);
    expect(result!.dollarRisk).toBe(150);
    expect(result!.shares).toBe(10);
  });

  it("returns null in PANIC VIX (0% size multiplier)", () => {
    const signal = makeSignal({ atr20: 10, suggestedEntry: 100 });
    const result = calculatePositionSize(signal, 10000, undefined, "PANIC");
    expect(result).toBeNull();
  });

  it("stacks VIX with equity curve CAUTION", () => {
    // CAUTION: riskPct=1%, ELEVATED VIX: 0.75× → effective=0.75%
    // dollarRisk = 10000 * 0.0075 = 75, riskPerShare=15, shares=5
    const signal = makeSignal({ atr20: 10, suggestedEntry: 100 });
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
      riskPctPerTrade: 1.0,
      reason: "Reduced risk",
      triggeredAt: null,
    };
    const result = calculatePositionSize(signal, 10000, cautionState, "ELEVATED");
    expect(result).not.toBeNull();
    expect(result!.dollarRisk).toBe(75);
    expect(result!.shares).toBe(5);
    expect(result!.vixMultiplier).toBe(0.75);
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
