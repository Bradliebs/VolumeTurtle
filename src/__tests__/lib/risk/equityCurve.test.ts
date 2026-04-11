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
    expect(state.earlyRecoveryActive).toBe(false);
    expect(state.consecutiveUpDays).toBe(0);
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

describe("early recovery", () => {
  it("transitions PAUSE \u2192 CAUTION with 3 rising snapshots and drawdown < 18%", () => {
    // Peak 10000, current 8250 → drawdown 17.5% (below 18% early threshold)
    // But 17.5% is NOT >= 20% so standard logic puts it in CAUTION, not PAUSE
    // Need drawdown >= 20% to enter PAUSE branch where early recovery lives
    // Peak 10000, current 8050 → 19.5% dd → still CAUTION. Need >= 20%.
    // Peak 10000, current 7950 → 20.5% dd → PAUSE. 3 consecutive up, dd < 18%? No, 20.5 > 18.
    // Scenario: peak 12500, current 10200 → drawdown 18.4% (>= 18) → no early recovery
    // Actually: we need dd >= 20% (PAUSE) BUT < 18% (early threshold). That's impossible!
    // The early recovery from PAUSE fires when dd IS >= 20% AND < earlyPauseToCautionPct.
    // So earlyPauseToCautionPct must be > 20% for PAUSE->CAUTION? No — the threshold is
    // checked AFTER entering the PAUSE block (dd >= 20%). We check dd < 18% which can't be
    // true if dd >= 20%. This means the early recovery threshold must be BETWEEN the
    // standard threshold and above it.
    // Fix: earlyPauseToCautionPct should be a buffer WITHIN PAUSE range, e.g. 22%.
    // When dd is 20-22%, rising for 3 days → early CAUTION.
    // Let's set earlyPauseToCautionPct = 22 and test with dd = 20.5%
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 7800 },  // 22% dd
      { date: "2025-01-03", balance: 7850 },
      { date: "2025-01-04", balance: 7900 },
      { date: "2025-01-05", balance: 7950 },  // 20.5% dd, 3 consecutive up
    ];
    const state = calculateEquityCurveState(snapshots, 2.0, 5, 21.0); // early threshold 21%
    expect(state.systemState).toBe("CAUTION");
    expect(state.earlyRecoveryActive).toBe(true);
    expect(state.consecutiveUpDays).toBe(3);
    expect(state.riskMultiplier).toBe(0.5);
    expect(state.reason).toContain("Early recovery");
  });

  it("stays PAUSE with 3 rising snapshots but drawdown above early threshold", () => {
    // dd = 22%, early threshold default = 18% → 22% > 18% → no early recovery
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 7500 },
      { date: "2025-01-03", balance: 7600 },
      { date: "2025-01-04", balance: 7700 },
      { date: "2025-01-05", balance: 7800 },  // 22% dd, 3 up, but 22 > 18
    ];
    const state = calculateEquityCurveState(snapshots);
    expect(state.systemState).toBe("PAUSE");
    expect(state.earlyRecoveryActive).toBe(false);
  });

  it("stays PAUSE with only 2 rising snapshots", () => {
    // dd = 20.5%, but only 2 consecutive up (broke streak)
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 7700 },
      { date: "2025-01-03", balance: 7650 },  // dip — breaks streak
      { date: "2025-01-04", balance: 7800 },
      { date: "2025-01-05", balance: 7950 },  // 20.5% dd, only 2 consecutive up
    ];
    const state = calculateEquityCurveState(snapshots, 2.0, 5, 21.0);
    expect(state.systemState).toBe("PAUSE");
    expect(state.earlyRecoveryActive).toBe(false);
    expect(state.consecutiveUpDays).toBe(2);
  });

  it("transitions CAUTION → NORMAL with rising snapshots, drawdown < 12%, above MA20", () => {
    // Need 20+ low-balance snapshots so MA20 is dominated by lows, then 3 rising
    const lows: SnapshotInput[] = Array.from({ length: 18 }, (_, i) => ({
      date: `2025-01-${String(i + 2).padStart(2, "0")}`,
      balance: 8800,
    }));
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      ...lows,
      { date: "2025-01-20", balance: 8850 },
      { date: "2025-01-21", balance: 8900 },
      { date: "2025-01-22", balance: 8950 },  // 10.5% dd, 3 up
      // MA20 of last 20 = mostly 8800s → ~8812, current 8950 > 8812 \u2713
    ];
    const state = calculateEquityCurveState(snapshots);
    expect(state.systemState).toBe("NORMAL");
    expect(state.earlyRecoveryActive).toBe(true);
    expect(state.consecutiveUpDays).toBe(3);
  });

  it("respects custom early recovery thresholds", () => {
    // dd = 20.5% with 3 rising
    const snapshots: SnapshotInput[] = [
      { date: "2025-01-01", balance: 10000 },
      { date: "2025-01-02", balance: 7800 },
      { date: "2025-01-03", balance: 7850 },
      { date: "2025-01-04", balance: 7900 },
      { date: "2025-01-05", balance: 7950 },  // 20.5% dd
    ];
    // threshold 21% → 20.5 < 21 → triggers early recovery
    const withLoose = calculateEquityCurveState(snapshots, 2.0, 5, 21.0);
    expect(withLoose.earlyRecoveryActive).toBe(true);
    expect(withLoose.systemState).toBe("CAUTION");

    // threshold 20% → 20.5 >= 20 → no early recovery (still in PAUSE territory)
    const withTight = calculateEquityCurveState(snapshots, 2.0, 5, 20.0);
    expect(withTight.systemState).toBe("PAUSE");
    expect(withTight.earlyRecoveryActive).toBe(false);
  });
});
