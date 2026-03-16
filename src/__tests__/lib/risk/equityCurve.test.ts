import {
  calculateEquityCurveState,
  shouldRecover,
} from "@/lib/risk/equityCurve";
import type { SnapshotInput } from "@/lib/risk/equityCurve";

describe("calculateEquityCurveState", () => {
  it("returns NORMAL with defaults for empty snapshots", () => {
    const state = calculateEquityCurveState([]);
    expect(state.systemState).toBe("NORMAL");
    expect(state.currentBalance).toBe(0);
    expect(state.peakBalance).toBe(0);
    expect(state.drawdownPct).toBe(0);
    expect(state.riskMultiplier).toBe(1.0);
    expect(state.maxPositions).toBe(5);
  });

  it("returns NORMAL when no drawdown", () => {
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 10100 },
      { date: "2025-01-03", balance: 10200 },
    ];
    const state = calculateEquityCurveState(snapshots);
    expect(state.systemState).toBe("NORMAL");
    expect(state.currentBalance).toBe(10200);
    expect(state.peakBalance).toBe(10200);
    expect(state.drawdownPct).toBe(0);
  });

  it("returns CAUTION when drawdown >= 10%", () => {
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 9000 }, // 10% drawdown
    ];
    const state = calculateEquityCurveState(snapshots);
    expect(state.systemState).toBe("CAUTION");
    expect(state.riskMultiplier).toBe(0.5);
    expect(state.maxPositions).toBe(3);
    expect(state.riskPctPerTrade).toBe(1.0); // 2.0 * 0.5
  });

  it("returns PAUSE when drawdown >= 20%", () => {
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 8000 }, // 20% drawdown
    ];
    const state = calculateEquityCurveState(snapshots);
    expect(state.systemState).toBe("PAUSE");
    expect(state.riskMultiplier).toBe(0);
    expect(state.maxPositions).toBe(0);
    expect(state.riskPctPerTrade).toBe(0);
  });

  it("calculates drawdown from peak, not initial", () => {
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 12000 }, // new peak
      { date: "2025-01-03", balance: 10800 }, // 10% from peak of 12000
    ];
    const state = calculateEquityCurveState(snapshots);
    expect(state.peakBalance).toBe(12000);
    expect(state.systemState).toBe("CAUTION");
  });

  it("computes equityMA20 only when >= 5 snapshots", () => {
    const few: SnapshotInput[] = Array.from({ length: 4 }, (_, i) => ({
      date: `2025-01-${i + 1}`,
      balance: 10000,
    }));
    expect(calculateEquityCurveState(few).equityMA20).toBeNull();

    const enough: SnapshotInput[] = Array.from({ length: 5 }, (_, i) => ({
      date: `2025-01-${i + 1}`,
      balance: 10000,
    }));
    expect(calculateEquityCurveState(enough).equityMA20).toBe(10000);
  });

  it("triggers CAUTION when below equity MA (even no drawdown)", () => {
    // Balance dips below the MA of recent snapshots
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 10000 },
      { date: "2025-01-03", balance: 10000 },
      { date: "2025-01-04", balance: 10000 },
      { date: "2025-01-05", balance: 9600 }, // below MA of 9920
    ];
    const state = calculateEquityCurveState(snapshots);
    expect(state.systemState).toBe("CAUTION");
  });

  it("accepts custom base risk and max positions", () => {
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
    ];
    const state = calculateEquityCurveState(snapshots, 3.0, 10);
    expect(state.riskPctPerTrade).toBe(3.0);
    expect(state.maxPositions).toBe(10);
  });
});

describe("shouldRecover", () => {
  it("returns false for NORMAL state", () => {
    const snapshots: SnapshotInput[] = Array.from({ length: 5 }, (_, i) => ({
      date: `2025-01-${i + 1}`,
      balance: 10000,
    }));
    expect(shouldRecover(snapshots, "NORMAL")).toBe(false);
  });

  it("returns false with fewer than 3 snapshots", () => {
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 10000 },
    ];
    expect(shouldRecover(snapshots, "CAUTION")).toBe(false);
  });

  it("recovers from CAUTION when drawdown clears and above MA", () => {
    // Build a history that was in caution, now recovered for 3 consecutive snapshots
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 10100 },
      { date: "2025-01-03", balance: 10200 },
    ];
    expect(shouldRecover(snapshots, "CAUTION")).toBe(true);
  });

  it("recovers from PAUSE when drawdown < 20% for 3 consecutive", () => {
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 8500 }, // 15% drawdown (< 20%)
      { date: "2025-01-03", balance: 8600 },
      { date: "2025-01-04", balance: 8700 },
    ];
    expect(shouldRecover(snapshots, "PAUSE")).toBe(true);
  });
});
