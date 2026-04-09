import {
  calculateCloseStrength,
  calculateVolumeExpansion,
  calculateRangeStability,
  detectFlowWindow,
  scoreTimingGate,
} from "@/lib/timing-scorer";

describe("calculateCloseStrength", () => {
  it("returns normalized close strength in normal case", () => {
    expect(calculateCloseStrength(105, 110, 100)).toBeCloseTo(0.5, 8);
  });

  it("returns 0.5 when high equals low", () => {
    expect(calculateCloseStrength(100, 100, 100)).toBe(0.5);
  });

  it("returns 1 when close is at high", () => {
    expect(calculateCloseStrength(110, 110, 100)).toBe(1);
  });

  it("returns 0 when close is at low", () => {
    expect(calculateCloseStrength(100, 110, 100)).toBe(0);
  });
});

describe("calculateVolumeExpansion", () => {
  it("returns ratio in normal case", () => {
    expect(calculateVolumeExpansion(1_200_000, 1_000_000)).toBeCloseTo(1.2, 8);
  });

  it("returns 1.0 guard when avgVolume20 is zero", () => {
    expect(calculateVolumeExpansion(1_200_000, 0)).toBe(1.0);
  });

  it("caps outlier values at 5", () => {
    expect(calculateVolumeExpansion(20_000_000, 1_000_000)).toBe(5);
  });
});

describe("calculateRangeStability", () => {
  it("returns stable range ratio", () => {
    expect(calculateRangeStability(110, 100, 8)).toBeCloseTo(1.25, 8);
  });

  it("flags chaotic day when ratio is greater than 2.5", () => {
    expect(calculateRangeStability(120, 100, 5)).toBeGreaterThan(2.5);
  });

  it("flags compression day when ratio is less than 0.5", () => {
    expect(calculateRangeStability(101, 100, 4)).toBeLessThan(0.5);
  });
});

describe("detectFlowWindow", () => {
  it("detects OPEX week window", () => {
    // April 2026 third Friday is 17th; 20th is +1 trading day.
    const result = detectFlowWindow(new Date("2026-04-20T00:00:00.000Z"));
    expect(result).toEqual({ flowFlag: true, flowType: "OPEX" });
  });

  it("detects month-end window", () => {
    const result = detectFlowWindow(new Date("2026-01-30T00:00:00.000Z"));
    expect(result).toEqual({ flowFlag: true, flowType: "MONTH_END" });
  });

  it("detects quarter-end window with precedence over month-end", () => {
    const result = detectFlowWindow(new Date("2026-03-29T00:00:00.000Z"));
    expect(result).toEqual({ flowFlag: true, flowType: "QUARTER_END" });
  });

  it("returns non-flow for ordinary date", () => {
    const result = detectFlowWindow(new Date("2026-02-10T00:00:00.000Z"));
    expect(result).toEqual({ flowFlag: false, flowType: null });
  });
});

describe("scoreTimingGate", () => {
  it("passes gate when timingScore is at least 70", () => {
    const result = scoreTimingGate({
      close: 10,
      high: 10,
      low: 8,
      volume: 1_000_000,
      avgVolume20: 1_000_000,
      atr14: 1,
      entryDate: new Date("2026-02-10T00:00:00.000Z"),
    });

    expect(result.timingScore).toBeGreaterThanOrEqual(70);
    expect(result.timingGatePass).toBe(true);
  });

  it("blocks gate when timingScore is below 70", () => {
    const result = scoreTimingGate({
      close: 8.2,
      high: 10,
      low: 8,
      volume: 800_000,
      avgVolume20: 1_000_000,
      atr14: 0.5,
      entryDate: new Date("2026-02-10T00:00:00.000Z"),
    });

    expect(result.timingScore).toBeLessThan(70);
    expect(result.timingGatePass).toBe(false);
  });

  it("sets multiplier to 1.3 when flowFlag is true and gate passes", () => {
    const result = scoreTimingGate({
      close: 10,
      high: 10,
      low: 8,
      volume: 1_300_000,
      avgVolume20: 1_000_000,
      atr14: 1,
      entryDate: new Date("2026-03-29T00:00:00.000Z"),
    });

    expect(result.flowFlag).toBe(true);
    expect(result.timingGatePass).toBe(true);
    expect(result.positionSizeMultiplier).toBe(1.3);
  });

  it("sets multiplier to 0.85 when score is 70-79 and no flow", () => {
    const result = scoreTimingGate({
      close: 10,
      high: 10,
      low: 8,
      volume: 1_000_000,
      avgVolume20: 1_000_000,
      atr14: 1,
      entryDate: new Date("2026-02-10T00:00:00.000Z"),
    });

    expect(result.timingScore).toBeGreaterThanOrEqual(70);
    expect(result.timingScore).toBeLessThan(80);
    expect(result.flowFlag).toBe(false);
    expect(result.positionSizeMultiplier).toBe(0.85);
  });

  it("sets multiplier to 0 when gate fails", () => {
    const result = scoreTimingGate({
      close: 8.2,
      high: 10,
      low: 8,
      volume: 700_000,
      avgVolume20: 1_000_000,
      atr14: 0.4,
      entryDate: new Date("2026-02-10T00:00:00.000Z"),
    });

    expect(result.timingGatePass).toBe(false);
    expect(result.positionSizeMultiplier).toBe(0);
  });
});