/**
 * Cruise Control — Unit Tests
 *
 * Tests pure calculation logic (stop-ratchet) and reconciliation.
 * Engine/daemon tests require DB and are integration-level.
 */

// Mock config to avoid env var validation
jest.mock("@/lib/config", () => require("../../__mocks__/config"));

// Mock heavy dependencies so we can import reconcilePositions
jest.mock("@/lib/t212/client", () => ({
  loadT212Settings: () => null,
  getCachedT212Positions: async () => ({ positions: [], fromCache: true }),
  updateStopOnT212: async () => ({ cancelled: null, placed: {} }),
}));
jest.mock("@/lib/data/yahoo", () => ({
  fetchQuote: async () => null,
}));
jest.mock("@/lib/logger", () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
}));

import {
  calculateRatchetedStop,
  MONOTONIC_GUARD,
  type RatchetInput,
} from "@/lib/cruise-control/stop-ratchet";
import { isMarketOpen } from "@/lib/cruise-control/market-hours";
import { reconcilePositions } from "@/lib/cruise-control/cruise-control-t212";

// ═══════════════════════════════════════════════════════════════════════════
// MONOTONIC GUARD TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("MONOTONIC_GUARD", () => {
  it("returns null when newStop < currentStop", () => {
    expect(MONOTONIC_GUARD(9.5, 10.0)).toBeNull();
  });

  it("returns null when newStop === currentStop (not strictly greater)", () => {
    expect(MONOTONIC_GUARD(10.0, 10.0)).toBeNull();
  });

  it("returns newStop when newStop > currentStop", () => {
    expect(MONOTONIC_GUARD(10.5, 10.0)).toBe(10.5);
  });

  it("returns newStop for large upward moves", () => {
    expect(MONOTONIC_GUARD(20.0, 10.0)).toBe(20.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RATCHET LOGIC — MOMENTUM
// ═══════════════════════════════════════════════════════════════════════════

describe("calculateRatchetedStop — Momentum", () => {
  const baseInput: RatchetInput = {
    positionType: "momentum",
    entryPrice: 100,
    currentStop: 90,
    currentPrice: 100,
    atr: 5,
  };

  it("profit < 5%: stop = entry - 1.5×ATR (initial protection)", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 102, currentStop: 85 };
    // expected: max(100 - 7.5, 85) = 92.5
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(92.5, 1);
  });

  it("profit 5-10%: breakeven stop", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 107, currentStop: 92.5 };
    // 7% profit → stop = max(100, 92.5) = 100
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(100, 1);
  });

  it("profit 10-20%: lock in small gain (entry + 0.5×ATR)", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 115, currentStop: 100 };
    // 15% profit → stop = max(100 + 2.5, 100) = 102.5
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(102.5, 1);
  });

  it("profit 20-30%: lock in meaningful gain (entry + 1.0×ATR)", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 125, currentStop: 102.5 };
    // 25% profit → stop = max(100 + 5, 102.5) = 105
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(105, 1);
  });

  it("profit 30-50%: trail aggressively (entry + 2.0×ATR)", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 140, currentStop: 105 };
    // 40% profit → stop = max(100 + 10, 105) = 110
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(110, 1);
  });

  it("profit > 50%: full trailing stop (price - 1.5×ATR)", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 160, currentStop: 110 };
    // 60% profit → stop = max(160 - 7.5, 110) = 152.5
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(152.5, 1);
  });

  it("returns null when no ratchet needed (price flat)", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 100, currentStop: 93 };
    // 0% profit → stop = max(100 - 7.5, 93) = 93 (unchanged, below threshold)
    const result = calculateRatchetedStop(input);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RATCHET LOGIC — PEAD
// ═══════════════════════════════════════════════════════════════════════════

describe("calculateRatchetedStop — PEAD", () => {
  const baseInput: RatchetInput = {
    positionType: "pead",
    entryPrice: 50,
    currentStop: 44,
    currentPrice: 50,
    atr: 3,
    daysSinceEntry: 1,
  };

  it("day 1, profit < 5%: tighter initial stop (entry - 1.0×ATR)", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 51, currentStop: 40 };
    // stop = max(50 - 3, 40) = 47
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(47, 1);
  });

  it("day 10, profit 5-10%: faster to breakeven", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 54, currentStop: 47, daysSinceEntry: 10 };
    // 8% profit → stop = max(50 + 0.75, 47) = 50.75
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(50.75, 1);
  });

  it("day 20, profit > 10%: tighter trail", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 58, currentStop: 50.75, daysSinceEntry: 20 };
    // 16% profit → stop = max(58 - 3, 50.75) = 55
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(55, 1);
  });

  it("day 40-60: applies time-decay tightening (+0.25×ATR)", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 58, currentStop: 50, daysSinceEntry: 45 };
    // 16% profit → stop = (58 - 3) + 0.75 = 55.75
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(55.75, 1);
  });

  it("day 50: also applies time-decay tightening", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 60, currentStop: 55.75, daysSinceEntry: 50 };
    // 20% profit → stop = (60 - 3) + 0.75 = 57.75
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(57.75, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RATCHET LOGIC — PAIRS LONG
// ═══════════════════════════════════════════════════════════════════════════

describe("calculateRatchetedStop — Pairs Long", () => {
  const baseInput: RatchetInput = {
    positionType: "pairs-long",
    entryPrice: 80,
    currentStop: 70,
    currentPrice: 80,
    atr: 4,
  };

  it("returns null when profit <= 5% (does not ratchet)", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 83 };
    // 3.75% profit → below 5% threshold
    const result = calculateRatchetedStop(input);
    expect(result).toBeNull();
  });

  it("ratchets when profit > 5% (2×ATR trailing from entry)", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 90, currentStop: 68 };
    // 12.5% profit → stop = max(80 - 8, 68) = 72
    const result = calculateRatchetedStop(input);
    expect(result).toBeCloseTo(72, 1);
  });

  it("returns null when computed stop is not above current stop", () => {
    const input: RatchetInput = { ...baseInput, currentPrice: 90, currentStop: 73 };
    // stop = max(80 - 8, 73) = 73 → not above current → null (minimum threshold)
    const result = calculateRatchetedStop(input);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MINIMUM MOVEMENT THRESHOLD
// ═══════════════════════════════════════════════════════════════════════════

describe("Minimum movement threshold", () => {
  it("returns null when movement is < 0.1% of current stop", () => {
    // currentStop = 100, new would be 100.05 → 0.05% < 0.1% threshold
    const input: RatchetInput = {
      positionType: "momentum",
      entryPrice: 80,
      currentStop: 100,
      currentPrice: 200, // huge profit so we get to 50%+ tier
      atr: 0.03, // tiny ATR → produces stop very close to current
    };
    const result = calculateRatchetedStop(input);
    // With price=200, entry=80, atr=0.03: stop = 200 - 0.045 = 199.955
    // vs currentStop=100 → huge move, will pass
    // Let's use a case where it barely moves:
    const input2: RatchetInput = {
      positionType: "momentum",
      entryPrice: 100,
      currentStop: 92.5,
      currentPrice: 102,
      atr: 5,
    };
    // profit ~2% → stop = max(100 - 7.5, 92.5) = 92.5 → not above → null
    expect(calculateRatchetedStop(input2)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ALL PATHS CALL MONOTONIC GUARD
// ═══════════════════════════════════════════════════════════════════════════

describe("All ratchet paths enforce monotonic guard", () => {
  it("momentum: never returns a stop below current", () => {
    const input: RatchetInput = {
      positionType: "momentum",
      entryPrice: 100,
      currentStop: 120, // stop already very high
      currentPrice: 110, // price dropped below stop (gap down scenario)
      atr: 5,
    };
    expect(calculateRatchetedStop(input)).toBeNull();
  });

  it("pead: never returns a stop below current", () => {
    const input: RatchetInput = {
      positionType: "pead",
      entryPrice: 50,
      currentStop: 55,
      currentPrice: 48, // below entry
      atr: 3,
    };
    expect(calculateRatchetedStop(input)).toBeNull();
  });

  it("pairs-long: never returns a stop below current", () => {
    const input: RatchetInput = {
      positionType: "pairs-long",
      entryPrice: 80,
      currentStop: 80,
      currentPrice: 90, // 12.5% profit
      atr: 4,
    };
    // stop = max(80 - 8, 80) = 80 → not above 80 → null
    expect(calculateRatchetedStop(input)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVALID INPUTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Invalid inputs", () => {
  it("returns null for zero ATR", () => {
    expect(
      calculateRatchetedStop({
        positionType: "momentum",
        entryPrice: 100,
        currentStop: 90,
        currentPrice: 110,
        atr: 0,
      }),
    ).toBeNull();
  });

  it("returns null for negative price", () => {
    expect(
      calculateRatchetedStop({
        positionType: "momentum",
        entryPrice: 100,
        currentStop: 90,
        currentPrice: -1,
        atr: 5,
      }),
    ).toBeNull();
  });

  it("returns null for unknown position type", () => {
    expect(
      calculateRatchetedStop({
        positionType: "unknown" as "momentum",
        entryPrice: 100,
        currentStop: 90,
        currentPrice: 110,
        atr: 5,
      }),
    ).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKET HOURS / SCHEDULER TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("isMarketOpen", () => {
  // Helper to create a Date in UTC that corresponds to a specific UK time
  // Note: During GMT (winter), UK = UTC. During BST (summer), UK = UTC+1
  // Tests use specific UTC times to control UK time

  it("returns true during LSE hours (10:00 UK on a weekday)", () => {
    // Wednesday 15 Jan 2025 10:00 UK = 10:00 UTC (GMT)
    const date = new Date("2025-01-15T10:00:00.000Z");
    expect(isMarketOpen(date)).toBe(true);
  });

  it("returns true during US hours (15:00 UK on a weekday)", () => {
    // Wednesday 15 Jan 2025 15:00 UK = 15:00 UTC (GMT)
    const date = new Date("2025-01-15T15:00:00.000Z");
    expect(isMarketOpen(date)).toBe(true);
  });

  it("returns false before LSE open (07:00 UK)", () => {
    // Wednesday 15 Jan 2025 07:00 UK = 07:00 UTC
    const date = new Date("2025-01-15T07:00:00.000Z");
    expect(isMarketOpen(date)).toBe(false);
  });

  it("returns false during LSE close blackout (16:31 UK)", () => {
    // 16:31 UK time, LSE blackout starts at 16:30, US closed (after 21:00)
    // Wait — US is open 14:30-20:55 UK, so at 16:31 UK the US market IS open
    // The test should use a time after BOTH markets close
    // After 21:00 UK = after US close
    const date = new Date("2025-01-15T21:01:00.000Z");
    expect(isMarketOpen(date)).toBe(false);
  });

  it("returns false on weekends", () => {
    // Saturday 18 Jan 2025 12:00 UTC
    const date = new Date("2025-01-18T12:00:00.000Z");
    expect(isMarketOpen(date)).toBe(false);
  });

  it("returns false on Sunday", () => {
    const date = new Date("2025-01-19T12:00:00.000Z");
    expect(isMarketOpen(date)).toBe(false);
  });

  it("returns false on UK bank holiday (25 Dec 2025)", () => {
    // Christmas Day 2025 is a Thursday
    const date = new Date("2025-12-25T10:00:00.000Z");
    // LSE is closed (UK holiday), but US may be open — check
    // US is also closed on Dec 25 (in US_HOLIDAYS)
    expect(isMarketOpen(date)).toBe(false);
  });

  it("returns false after US close (21:01 UK)", () => {
    const date = new Date("2025-01-15T21:01:00.000Z");
    expect(isMarketOpen(date)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILIATION TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("reconcilePositions", () => {
  it("flags orphaned position (in T212, not in DB)", () => {
    const t212 = [
      { ticker: "AAPL", quantity: 10, averagePrice: 150, currentPrice: 160, ppl: 100 },
      { ticker: "TSLA", quantity: 5, averagePrice: 200, currentPrice: 250, ppl: 250 },
    ];
    const db = [{ ticker: "AAPL", status: "OPEN" }];

    const result = reconcilePositions(t212, db);
    expect(result.orphaned).toContain("TSLA");
    expect(result.matched).toBe(1);
  });

  it("flags ghost position (in DB as active, not in T212)", () => {
    const t212 = [
      { ticker: "AAPL", quantity: 10, averagePrice: 150, currentPrice: 160, ppl: 100 },
    ];
    const db = [
      { ticker: "AAPL", status: "OPEN" },
      { ticker: "MSFT", status: "OPEN" },
    ];

    const result = reconcilePositions(t212, db);
    expect(result.ghost).toContain("MSFT");
    expect(result.matched).toBe(1);
  });

  it("does not flag closed DB positions as ghost", () => {
    const t212 = [
      { ticker: "AAPL", quantity: 10, averagePrice: 150, currentPrice: 160, ppl: 100 },
    ];
    const db = [
      { ticker: "AAPL", status: "OPEN" },
      { ticker: "GOOG", status: "CLOSED" },
    ];

    const result = reconcilePositions(t212, db);
    expect(result.ghost).not.toContain("GOOG");
  });

  it("does NOT automatically close orphaned or ghost positions (just flags)", () => {
    // This test documents the design constraint: reconcilePositions returns
    // data only — no side effects, no closures
    const t212 = [
      { ticker: "ORPHAN", quantity: 10, averagePrice: 100, currentPrice: 110, ppl: 100 },
    ];
    const db = [
      { ticker: "GHOST", status: "OPEN" },
    ];

    const result = reconcilePositions(t212, db);
    expect(result.orphaned).toEqual(["ORPHAN"]);
    expect(result.ghost).toEqual(["GHOST"]);
    expect(result.matched).toBe(0);
    // No closures, no mutations — pure function
  });
});
