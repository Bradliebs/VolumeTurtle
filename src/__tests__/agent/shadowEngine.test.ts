import { computeShadowVerdict, detectDivergences } from "@/agent/shadowEngine";
import type { AgentContext } from "@/agent/context";
import type { CycleAction } from "@/agent/logger";

// ── Helpers ──────────────────────────────────────────────────────

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    timestamp: new Date().toISOString(),
    haltFlag: { halted: false, reason: null },
    account: { equity: 10000, cash: 5000, snapshotAt: new Date().toISOString() },
    openPositions: [],
    pendingSignals: [],
    riskBudget: {
      maxPositions: 5,
      openPositions: 0,
      slotsAvailable: 5,
      heatCapPct: 8,
      currentHeatPct: 0,
      heatCapacityRemaining: 8,
      regimeBullish: true,
    },
    settings: {
      autoExecutionEnabled: true,
      autoExecutionMinGrade: "B",
      maxPositionsPerSector: 2,
      drawdownState: "NORMAL",
    },
    recentActivity: { lastCycleAt: null, ratchetsThisCycle: 0 },
    timeStopFlags: [],
    consecutiveFailures: 0,
    cycleId: "test-cycle",
    ...overrides,
  };
}

function makeSignal(overrides: Partial<AgentContext["pendingSignals"][0]> = {}) {
  return {
    id: 1,
    ticker: "AAPL",
    grade: "B",
    compositeScore: 7.5,
    entryPrice: 150,
    stopPrice: 140,
    stopDistancePct: 6.67,
    riskPct: 1.0,
    dollarRisk: 100,
    suggestedShares: 10,
    oneRTarget: 160,
    twoRTarget: 170,
    sector: "Technology",
    engine: "volume",
    convergence: false,
    ...overrides,
  };
}

function makeAction(
  toolName: string,
  success: boolean,
  input: Record<string, unknown> = {},
  data: Record<string, unknown> = {},
): CycleAction {
  return {
    toolName,
    toolInput: input,
    result: { success, data },
    durationMs: 100,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("Shadow Rules Engine", () => {
  describe("computeShadowVerdict", () => {
    it("blocks when halted", () => {
      const ctx = makeContext({ haltFlag: { halted: true, reason: "Manual halt" } });
      const v = computeShadowVerdict(ctx);
      expect(v.shouldBlock).toBe(true);
      expect(v.blockReason).toContain("HALT");
    });

    it("blocks when regime bearish", () => {
      const ctx = makeContext({
        riskBudget: {
          maxPositions: 5, openPositions: 0, slotsAvailable: 5,
          heatCapPct: 8, currentHeatPct: 0, heatCapacityRemaining: 8,
          regimeBullish: false,
        },
      });
      const v = computeShadowVerdict(ctx);
      expect(v.shouldBlock).toBe(true);
      expect(v.blockReason).toContain("BEARISH");
    });

    it("blocks when drawdown PAUSE", () => {
      const ctx = makeContext({
        settings: {
          autoExecutionEnabled: true, autoExecutionMinGrade: "B",
          maxPositionsPerSector: 2, drawdownState: "PAUSE",
        },
      });
      const v = computeShadowVerdict(ctx);
      expect(v.shouldBlock).toBe(true);
      expect(v.blockReason).toContain("PAUSE");
    });

    it("blocks when no slots", () => {
      const ctx = makeContext({
        riskBudget: {
          maxPositions: 5, openPositions: 5, slotsAvailable: 0,
          heatCapPct: 8, currentHeatPct: 6, heatCapacityRemaining: 2,
          regimeBullish: true,
        },
      });
      const v = computeShadowVerdict(ctx);
      expect(v.shouldBlock).toBe(true);
    });

    it("blocks when heat exhausted", () => {
      const ctx = makeContext({
        riskBudget: {
          maxPositions: 5, openPositions: 3, slotsAvailable: 2,
          heatCapPct: 8, currentHeatPct: 8, heatCapacityRemaining: 0,
          regimeBullish: true,
        },
      });
      const v = computeShadowVerdict(ctx);
      expect(v.shouldBlock).toBe(true);
      expect(v.blockReason).toContain("Heat");
    });

    it("allows Grade B+ signals through", () => {
      const ctx = makeContext({
        pendingSignals: [
          makeSignal({ id: 1, ticker: "AAPL", grade: "A", compositeScore: 9 }),
          makeSignal({ id: 2, ticker: "MSFT", grade: "B", compositeScore: 7 }),
          makeSignal({ id: 3, ticker: "TSLA", grade: "C", compositeScore: 5 }),
        ],
      });
      const v = computeShadowVerdict(ctx);
      expect(v.shouldBlock).toBe(false);
      expect(v.shouldExecute).toHaveLength(2);
      expect(v.shouldExecute[0]!.ticker).toBe("AAPL");
      expect(v.shouldExecute[1]!.ticker).toBe("MSFT");
      expect(v.shouldSkip).toHaveLength(1);
      expect(v.shouldSkip[0]!.ticker).toBe("TSLA");
    });

    it("skips already-held tickers", () => {
      const ctx = makeContext({
        openPositions: [{
          id: 1, ticker: "AAPL", entryPrice: 150, currentStop: 140,
          shares: 10, sector: "Technology", riskPct: 1, unrealisedPnl: null,
          daysOpen: 5, compositeGrade: "B", daysStagnant: 0,
          stopDistanceFromEntryPct: 6.67, pnlR: 0.5, initialStop: 140,
        }],
        pendingSignals: [makeSignal({ ticker: "AAPL" })],
      });
      const v = computeShadowVerdict(ctx);
      expect(v.shouldExecute).toHaveLength(0);
      expect(v.shouldSkip[0]!.reason).toContain("Already held");
    });

    it("skips at sector cap", () => {
      const ctx = makeContext({
        openPositions: [
          {
            id: 1, ticker: "MSFT", entryPrice: 300, currentStop: 280,
            shares: 5, sector: "Technology", riskPct: 1, unrealisedPnl: null,
            daysOpen: 10, compositeGrade: "B", daysStagnant: 0,
            stopDistanceFromEntryPct: 6.67, pnlR: 0.3, initialStop: 280,
          },
          {
            id: 2, ticker: "GOOG", entryPrice: 120, currentStop: 110,
            shares: 8, sector: "Technology", riskPct: 1, unrealisedPnl: null,
            daysOpen: 8, compositeGrade: "B", daysStagnant: 0,
            stopDistanceFromEntryPct: 8.33, pnlR: 0.2, initialStop: 110,
          },
        ],
        pendingSignals: [makeSignal({ ticker: "AAPL", sector: "Technology" })],
      });
      const v = computeShadowVerdict(ctx);
      expect(v.shouldSkip[0]!.reason).toContain("Sector");
    });

    it("ranks convergence signals first", () => {
      const ctx = makeContext({
        pendingSignals: [
          makeSignal({ id: 1, ticker: "AAPL", grade: "A", compositeScore: 9, convergence: false }),
          makeSignal({ id: 2, ticker: "MSFT", grade: "B", compositeScore: 7, convergence: true }),
        ],
      });
      const v = computeShadowVerdict(ctx);
      expect(v.shouldExecute[0]!.ticker).toBe("MSFT"); // convergence first
      expect(v.shouldExecute[1]!.ticker).toBe("AAPL");
    });

    it("allows 2 executions when both top signals are convergence", () => {
      const ctx = makeContext({
        pendingSignals: [
          makeSignal({ id: 1, ticker: "AAPL", grade: "A", convergence: true }),
          makeSignal({ id: 2, ticker: "MSFT", grade: "B", convergence: true }),
        ],
      });
      const v = computeShadowVerdict(ctx);
      expect(v.maxExecutions).toBe(2);
    });

    it("limits to 1 execution when signals are not both convergence", () => {
      const ctx = makeContext({
        pendingSignals: [
          makeSignal({ id: 1, ticker: "AAPL", grade: "A", convergence: true }),
          makeSignal({ id: 2, ticker: "MSFT", grade: "B", convergence: false }),
        ],
      });
      const v = computeShadowVerdict(ctx);
      expect(v.maxExecutions).toBe(1);
    });
  });

  describe("detectDivergences", () => {
    it("returns empty when aligned", () => {
      const ctx = makeContext({
        pendingSignals: [makeSignal({ id: 1, ticker: "AAPL", grade: "B" })],
      });
      const verdict = computeShadowVerdict(ctx);
      const actions = [
        makeAction("execute_signal", true, { pendingOrderId: 1 }, { ticker: "AAPL" }),
      ];
      const divs = detectDivergences(verdict, actions);
      expect(divs).toHaveLength(0);
    });

    it("detects EXECUTED_BLOCKED", () => {
      const ctx = makeContext({
        haltFlag: { halted: true, reason: "test" },
      });
      const verdict = computeShadowVerdict(ctx);
      const actions = [
        makeAction("execute_signal", true, { ticker: "AAPL" }, { ticker: "AAPL" }),
      ];
      const divs = detectDivergences(verdict, actions);
      expect(divs).toHaveLength(1);
      expect(divs[0]!.type).toBe("EXECUTED_BLOCKED");
    });

    it("detects EXECUTED_UNEXPECTED (grade too low)", () => {
      const ctx = makeContext({
        pendingSignals: [makeSignal({ id: 1, ticker: "TSLA", grade: "C" })],
      });
      const verdict = computeShadowVerdict(ctx);
      const actions = [
        makeAction("execute_signal", true, { ticker: "TSLA" }, { ticker: "TSLA" }),
      ];
      const divs = detectDivergences(verdict, actions);
      expect(divs).toHaveLength(1);
      expect(divs[0]!.type).toBe("EXECUTED_UNEXPECTED");
    });

    it("detects SKIPPED_EXPECTED", () => {
      const ctx = makeContext({
        pendingSignals: [makeSignal({ id: 1, ticker: "AAPL", grade: "A" })],
      });
      const verdict = computeShadowVerdict(ctx);
      const actions: CycleAction[] = []; // agent did nothing
      const divs = detectDivergences(verdict, actions);
      expect(divs).toHaveLength(1);
      expect(divs[0]!.type).toBe("SKIPPED_EXPECTED");
    });

    it("does not flag skip of non-top signals", () => {
      const ctx = makeContext({
        pendingSignals: [
          makeSignal({ id: 1, ticker: "AAPL", grade: "A", compositeScore: 9 }),
          makeSignal({ id: 2, ticker: "MSFT", grade: "B", compositeScore: 7 }),
        ],
      });
      const verdict = computeShadowVerdict(ctx);
      // Agent executed AAPL (top pick) but not MSFT — that's fine with maxExecutions=1
      const actions = [
        makeAction("execute_signal", true, { ticker: "AAPL" }, { ticker: "AAPL" }),
      ];
      const divs = detectDivergences(verdict, actions);
      expect(divs).toHaveLength(0);
    });
  });
});
