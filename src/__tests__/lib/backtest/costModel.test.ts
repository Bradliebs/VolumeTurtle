import {
  applyEntrySlippage,
  applyExitSlippage,
  calculateRoundTripCosts,
  DEFAULT_COST_MODEL,
} from "@/lib/backtest/costModel";

describe("costModel", () => {
  describe("applyEntrySlippage", () => {
    it("increases the entry price by slippage + spread bps", () => {
      const cost = { commissionPerTrade: 0, slippageBps: 5, spreadBps: 15 };
      // 20 bps total = 0.20%
      const fill = applyEntrySlippage(100, cost);
      expect(fill).toBeCloseTo(100.20, 6);
    });

    it("returns the reference price when slippage and spread are zero", () => {
      const cost = { commissionPerTrade: 0, slippageBps: 0, spreadBps: 0 };
      expect(applyEntrySlippage(50, cost)).toBe(50);
    });
  });

  describe("applyExitSlippage", () => {
    it("decreases the exit price by slippage + spread bps", () => {
      const cost = { commissionPerTrade: 0, slippageBps: 5, spreadBps: 15 };
      const fill = applyExitSlippage(100, cost);
      expect(fill).toBeCloseTo(99.80, 6);
    });

    it("is symmetric with applyEntrySlippage around the reference price", () => {
      const cost = { commissionPerTrade: 0, slippageBps: 10, spreadBps: 20 };
      const ref = 200;
      const entry = applyEntrySlippage(ref, cost);
      const exit = applyExitSlippage(ref, cost);
      expect(entry - ref).toBeCloseTo(ref - exit, 6);
    });
  });

  describe("calculateRoundTripCosts", () => {
    it("sums slippage on both legs plus 2x commission", () => {
      const cost = { commissionPerTrade: 1, slippageBps: 5, spreadBps: 15 };
      // 20 bps × £100 × 100 shares × 2 legs = £40 slippage; + 2×£1 commission = £42
      const total = calculateRoundTripCosts(100, 100, 100, cost);
      expect(total).toBeCloseTo(42, 4);
    });

    it("returns 2x commission only when slippage and spread are zero", () => {
      const cost = { commissionPerTrade: 2.5, slippageBps: 0, spreadBps: 0 };
      expect(calculateRoundTripCosts(100, 110, 50, cost)).toBeCloseTo(5, 4);
    });
  });

  describe("DEFAULT_COST_MODEL", () => {
    it("matches calibrated retail T212 defaults", () => {
      expect(DEFAULT_COST_MODEL.commissionPerTrade).toBe(0);
      expect(DEFAULT_COST_MODEL.slippageBps).toBeGreaterThan(0);
      expect(DEFAULT_COST_MODEL.spreadBps).toBeGreaterThan(0);
    });
  });
});
