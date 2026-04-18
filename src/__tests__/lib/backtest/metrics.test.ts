import {
  toDailyReturns,
  sharpe,
  sortino,
  maxDrawdown,
  profitFactor,
  expectancyR,
  winRate,
  cagrPct,
  summarise,
} from "@/lib/backtest/metrics";
import type { DailyEquityPoint, SimTrade } from "@/lib/backtest/types";

const point = (date: string, equity: number): DailyEquityPoint => ({
  date,
  equity,
  openPositions: 0,
  drawdownPct: 0,
});

const trade = (pnlNet: number, rMultiple: number): SimTrade => ({
  ticker: "TEST",
  entryDate: "2025-01-01",
  entryPrice: 100,
  rawEntryPrice: 100,
  shares: 1,
  hardStop: 95,
  signalGrade: "A",
  signalScore: 0.8,
  volumeRatio: 3,
  atr20: 1,
  exitDate: "2025-01-05",
  exitPrice: 100 + pnlNet,
  rawExitPrice: 100 + pnlNet,
  exitReason: "TRAILING_STOP",
  pnl: pnlNet,
  pnlNet,
  costs: 0,
  rMultiple,
  barsHeld: 4,
});

describe("metrics", () => {
  describe("toDailyReturns", () => {
    it("returns empty for fewer than 2 points", () => {
      expect(toDailyReturns([])).toEqual([]);
      expect(toDailyReturns([point("2025-01-01", 100)])).toEqual([]);
    });

    it("calculates simple period returns", () => {
      const curve = [point("a", 100), point("b", 110), point("c", 99)];
      const r = toDailyReturns(curve);
      expect(r).toHaveLength(2);
      expect(r[0]).toBeCloseTo(0.10, 4);
      expect(r[1]).toBeCloseTo(-0.10, 4);
    });

    it("returns 0 when previous equity is non-positive (avoids div by zero)", () => {
      const curve = [point("a", 0), point("b", 50)];
      expect(toDailyReturns(curve)).toEqual([0]);
    });
  });

  describe("sharpe", () => {
    it("returns 0 for empty or single-element series", () => {
      expect(sharpe([])).toBe(0);
      expect(sharpe([0.01])).toBe(0);
    });

    it("returns 0 when std dev is zero (avoids Infinity)", () => {
      expect(sharpe([0.01, 0.01, 0.01])).toBe(0);
    });

    it("is positive for upward-trending returns", () => {
      const s = sharpe([0.01, 0.02, 0.005, 0.015]);
      expect(s).toBeGreaterThan(0);
    });
  });

  describe("sortino", () => {
    it("returns 0 when there are no negative returns", () => {
      expect(sortino([0.01, 0.02, 0.005])).toBe(0);
    });

    it("penalises downside more harshly than Sharpe", () => {
      const returns = [0.02, -0.01, 0.015, -0.005, 0.01];
      const sh = sharpe(returns);
      const so = sortino(returns);
      // Both should be positive for net-positive returns; Sortino typically
      // higher because it ignores upside variance.
      expect(so).toBeGreaterThan(sh);
    });
  });

  describe("maxDrawdown", () => {
    it("returns zero for an always-rising curve", () => {
      const curve = [point("a", 100), point("b", 110), point("c", 120)];
      const dd = maxDrawdown(curve);
      expect(dd.maxDrawdownPct).toBe(0);
      expect(dd.maxDrawdownDays).toBe(0);
    });

    it("captures peak-to-trough drawdown as positive percent", () => {
      // 100 → 120 (peak) → 90 = 25% drawdown
      const curve = [point("a", 100), point("b", 120), point("c", 90), point("d", 95)];
      const dd = maxDrawdown(curve);
      expect(dd.maxDrawdownPct).toBeCloseTo(25, 4);
    });

    it("tracks the longest underwater period in days", () => {
      const curve = [
        point("a", 100), point("b", 90), point("c", 80),
        point("d", 85), point("e", 110), point("f", 100),
      ];
      const dd = maxDrawdown(curve);
      // Underwater for days b-d (3 days), then recovers, then 1 more day at f.
      expect(dd.maxDrawdownDays).toBe(3);
    });
  });

  describe("profitFactor", () => {
    it("returns 0 for no trades", () => {
      expect(profitFactor([])).toBe(0);
    });

    it("returns Infinity when there are wins but no losses", () => {
      expect(profitFactor([trade(10, 1), trade(20, 2)])).toBe(Number.POSITIVE_INFINITY);
    });

    it("computes gross win / gross loss correctly", () => {
      const trades = [trade(30, 1.5), trade(-10, -0.5), trade(20, 1), trade(-20, -1)];
      // Wins: 30 + 20 = 50; Losses: 10 + 20 = 30; PF = 50/30 ≈ 1.667
      expect(profitFactor(trades)).toBeCloseTo(50 / 30, 4);
    });
  });

  describe("expectancyR", () => {
    it("returns 0 for no trades", () => {
      expect(expectancyR([])).toBe(0);
    });

    it("averages R-multiples", () => {
      expect(expectancyR([trade(10, 2), trade(-5, -1), trade(15, 3)])).toBeCloseTo(4 / 3, 4);
    });
  });

  describe("winRate", () => {
    it("returns 0 for no trades", () => {
      expect(winRate([])).toBe(0);
    });

    it("counts only strictly positive net P&L as wins", () => {
      const trades = [trade(10, 1), trade(0, 0), trade(-5, -1), trade(20, 2)];
      // 2 wins out of 4 = 0.5 (the zero-pnl trade is NOT a win)
      expect(winRate(trades)).toBe(0.5);
    });
  });

  describe("cagrPct", () => {
    it("returns 0 for non-positive inputs", () => {
      expect(cagrPct(0, 100, 1)).toBe(0);
      expect(cagrPct(100, 200, 0)).toBe(0);
    });

    it("computes compound annual growth rate", () => {
      // 100 → 200 over 1 year = 100% CAGR
      expect(cagrPct(100, 200, 1)).toBeCloseTo(100, 4);
      // 100 → 121 over 2 years = 10% CAGR
      expect(cagrPct(100, 121, 2)).toBeCloseTo(10, 4);
    });
  });

  describe("summarise", () => {
    it("produces a complete summary from trades + curve", () => {
      const trades = [trade(50, 1), trade(-25, -0.5)];
      const curve = [point("a", 1000), point("b", 1050), point("c", 1025)];
      const s = summarise(trades, curve, 1000);
      expect(s.trades).toBe(2);
      expect(s.wins).toBe(1);
      expect(s.losses).toBe(1);
      expect(s.winRate).toBe(0.5);
      expect(s.profitFactor).toBeCloseTo(2, 4);
      expect(s.totalReturnPct).toBeCloseTo(2.5, 4);
      expect(s.finalEquity).toBe(1025);
    });

    it("computes CAGR from CALENDAR elapsed years, not trading-day count", () => {
      // 2-year window (calendar): 1000 → 1500 should be ≈22.5% CAGR,
      // regardless of how many trading-day points exist in the curve.
      const sparseCurve = [
        point("2024-01-01", 1000),
        point("2024-07-01", 1200),
        point("2025-01-01", 1300),
        point("2026-01-01", 1500),
      ];
      const s = summarise([], sparseCurve, 1000);
      // sqrt(1.5) - 1 = ~0.2247 → 22.47%
      expect(s.cagrPct).toBeCloseTo(22.47, 1);
    });
  });
});
