import {
  calculateStopAlignment,
  groupAndAggregateClosedTrades,
  type StopAlignmentState,
} from "@/app/components/dashboardUtils";
import type { Trade, TradeWithHistory, SyncResult, Instruction, ActionItem } from "@/app/components/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t1",
    ticker: "AAPL",
    entryDate: "2026-03-01",
    entryPrice: 100,
    shares: 10,
    hardStop: 90,
    trailingStop: 92,
    exitDate: null,
    exitPrice: null,
    exitReason: null,
    rMultiple: null,
    status: "OPEN",
    volumeRatio: 2.5,
    rangePosition: 0.8,
    atr20: 3.0,
    importedFromT212: false,
    importedAt: null,
    isRunner: false,
    runnerActivatedAt: null,
    runnerPeakProfit: null,
    runnerExitProfit: null,
    runnerCaptureRate: null,
    stopPushedAt: null,
    stopPushAttempts: 0,
    sector: "Technology",
    ...overrides,
  };
}

function makeOpenTrade(overrides: Partial<Trade> = {}): TradeWithHistory {
  return { ...makeTrade(overrides), stopHistory: [] };
}

// ── calculateStopAlignment ──────────────────────────────────────────────────

describe("calculateStopAlignment", () => {
  it("returns 'none' when no open trades", () => {
    expect(calculateStopAlignment([], {}, {}, [], [])).toBe("none");
  });

  it("returns 'unknown' when a trade has no sync data and no dashboard t212 price", () => {
    const trades = [makeOpenTrade({ id: "t1", ticker: "AAPL" })];
    expect(calculateStopAlignment(trades, {}, {}, [], [])).toBe("unknown");
  });

  it("returns 'aligned' when T212 stop matches DB stop within tolerance", () => {
    const trades = [makeOpenTrade({ id: "t1", ticker: "AAPL", hardStop: 90, trailingStop: 92 })];
    const syncData: Record<string, SyncResult> = {
      t1: { tradeId: "t1", ticker: "AAPL", t212: { currentPrice: 105, quantity: 10, averagePrice: 100, ppl: 50, stopLoss: 92, confirmed: true } },
    };
    expect(calculateStopAlignment(trades, syncData, undefined, [], [])).toBe("aligned");
  });

  it("returns 'needs_update' when T212 stop is below DB stop beyond tolerance", () => {
    const trades = [makeOpenTrade({ id: "t1", ticker: "AAPL", hardStop: 90, trailingStop: 95 })];
    const syncData: Record<string, SyncResult> = {
      t1: { tradeId: "t1", ticker: "AAPL", t212: { currentPrice: 105, quantity: 10, averagePrice: 100, ppl: 50, stopLoss: 90, confirmed: true } },
    };
    expect(calculateStopAlignment(trades, syncData, undefined, [], [])).toBe("needs_update");
  });

  it("returns 'needs_update' when instructions contain UPDATE_STOP", () => {
    const trades = [makeOpenTrade({ id: "t1", ticker: "AAPL" })];
    const syncData: Record<string, SyncResult> = {
      t1: { tradeId: "t1", ticker: "AAPL", t212: { currentPrice: 105, quantity: 10, averagePrice: 100, ppl: 50, stopLoss: 92, confirmed: true } },
    };
    const instructions: Instruction[] = [{ type: "UPDATE_STOP", message: "Update stop", urgent: false, ticker: "AAPL" } as unknown as Instruction];
    expect(calculateStopAlignment(trades, syncData, undefined, instructions, [])).toBe("needs_update");
  });

  it("uses dashboard t212Prices as fallback when sync data is missing", () => {
    const trades = [makeOpenTrade({ id: "t1", ticker: "AAPL", hardStop: 90, trailingStop: 92 })];
    const t212Prices = { AAPL: { currentPrice: 105, ppl: 50, stopLoss: 92 } };
    expect(calculateStopAlignment(trades, {}, t212Prices, [], [])).toBe("aligned");
  });
});

// ── groupAndAggregateClosedTrades ───────────────────────────────────────────

describe("groupAndAggregateClosedTrades", () => {
  it("returns empty structure for no trades", () => {
    const result = groupAndAggregateClosedTrades([]);
    expect(result.closedOnly).toEqual([]);
    expect(result.grouped).toEqual([]);
    expect(result.totalPnl).toBe(0);
    expect(result.totalR).toBe(0);
    expect(result.tickerCount).toBe(0);
  });

  it("calculates total P&L correctly for 3 closed trades", () => {
    const trades = [
      makeTrade({ id: "t1", ticker: "AAPL", entryPrice: 100, exitPrice: 110, shares: 10, exitDate: "2026-03-10", rMultiple: 1.5, status: "CLOSED" }),
      makeTrade({ id: "t2", ticker: "TSLA", entryPrice: 200, exitPrice: 190, shares: 5, exitDate: "2026-03-11", rMultiple: -0.5, status: "CLOSED" }),
      makeTrade({ id: "t3", ticker: "AAPL", entryPrice: 105, exitPrice: 115, shares: 8, exitDate: "2026-03-12", rMultiple: 1.2, status: "CLOSED" }),
    ];
    const result = groupAndAggregateClosedTrades(trades);

    // AAPL t1: (110-100)*10 = 100, TSLA t2: (190-200)*5 = -50, AAPL t3: (115-105)*8 = 80
    expect(result.totalPnl).toBe(130);
    expect(result.totalR).toBeCloseTo(2.2);
    expect(result.tickerCount).toBe(2);
  });

  it("groups by ticker and sorts groups by most recent exit date", () => {
    const trades = [
      makeTrade({ id: "t1", ticker: "AAPL", exitDate: "2026-03-10", exitPrice: 110, status: "CLOSED" }),
      makeTrade({ id: "t2", ticker: "TSLA", exitDate: "2026-03-12", exitPrice: 210, status: "CLOSED" }),
      makeTrade({ id: "t3", ticker: "AAPL", exitDate: "2026-03-11", exitPrice: 115, status: "CLOSED" }),
    ];
    const result = groupAndAggregateClosedTrades(trades);

    expect(result.grouped[0]!.ticker).toBe("TSLA"); // most recent exit
    expect(result.grouped[1]!.ticker).toBe("AAPL");
    expect(result.grouped[1]!.tradeCount).toBe(2);
  });

  it("calculates running P&L history in ascending date order", () => {
    const trades = [
      makeTrade({ id: "t1", ticker: "AAPL", entryPrice: 100, exitPrice: 110, shares: 10, exitDate: "2026-03-10", rMultiple: 1.0, status: "CLOSED" }),
      makeTrade({ id: "t2", ticker: "AAPL", entryPrice: 105, exitPrice: 100, shares: 5, exitDate: "2026-03-15", rMultiple: -0.5, status: "CLOSED" }),
    ];
    const result = groupAndAggregateClosedTrades(trades);
    const aapl = result.grouped.find((g) => g.ticker === "AAPL")!;

    expect(aapl.history[0]!.pnl).toBe(100); // (110-100)*10
    expect(aapl.history[0]!.runningPnl).toBe(100);
    expect(aapl.history[1]!.pnl).toBe(-25); // (100-105)*5
    expect(aapl.history[1]!.runningPnl).toBe(75);
  });

  it("calculates P&L by currency for mixed USD/GBP trades", () => {
    const trades = [
      makeTrade({ id: "t1", ticker: "AAPL", entryPrice: 100, exitPrice: 110, shares: 10, exitDate: "2026-03-10", status: "CLOSED" }),
      makeTrade({ id: "t2", ticker: "VOD.L", entryPrice: 1.00, exitPrice: 1.10, shares: 100, exitDate: "2026-03-11", status: "CLOSED" }),
    ];
    const result = groupAndAggregateClosedTrades(trades);

    expect(result.totalPnlByCurrency["$"]).toBe(100); // AAPL: (110-100)*10
    expect(result.totalPnlByCurrency["£"]).toBeCloseTo(10);  // VOD.L: (1.10-1.00)*100
  });

  it("handles trades with null exitPrice gracefully", () => {
    const trades = [
      makeTrade({ id: "t1", ticker: "AAPL", exitPrice: null, exitDate: null, status: "OPEN" }),
      makeTrade({ id: "t2", ticker: "TSLA", entryPrice: 200, exitPrice: 220, shares: 5, exitDate: "2026-03-10", rMultiple: 1.0, status: "CLOSED" }),
    ];
    const result = groupAndAggregateClosedTrades(trades);
    expect(result.totalPnl).toBe(100); // Only TSLA counts
  });
});
