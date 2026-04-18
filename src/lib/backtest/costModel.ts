// Cost model — applies realistic execution friction to backtests.
//
// All three components combine to model the gap between the close price the
// signal sees and what a real broker fill would have looked like. Defaults are
// calibrated for small-to-mid cap LSE/US equities executed via Trading 212.

import type { CostModel } from "./types";

/** Sensible defaults for a Trading 212 retail account on £-denominated equities. */
export const DEFAULT_COST_MODEL: CostModel = {
  commissionPerTrade: 0,   // T212 is commission-free
  slippageBps: 5,          // 5 bps adverse fill on average
  spreadBps: 15,           // 15 bps half-spread for small/mid cap
};

/**
 * Compute the post-slippage entry price.
 * On entry, the trader pays *more* than the reference close.
 *
 * Returned price = referenceClose × (1 + (slippage + spread) / 10_000)
 */
export function applyEntrySlippage(
  referenceClose: number,
  cost: CostModel,
): number {
  const bps = cost.slippageBps + cost.spreadBps;
  return referenceClose * (1 + bps / 10_000);
}

/**
 * Compute the post-slippage exit price.
 * On exit, the trader receives *less* than the reference close (or stop).
 */
export function applyExitSlippage(
  referenceClose: number,
  cost: CostModel,
): number {
  const bps = cost.slippageBps + cost.spreadBps;
  return referenceClose * (1 - bps / 10_000);
}

/**
 * Total round-trip costs for a single trade.
 * Includes commission on both legs + the implicit cost of the slippage gap.
 */
export function calculateRoundTripCosts(
  rawEntryPrice: number,
  rawExitPrice: number,
  shares: number,
  cost: CostModel,
): number {
  const entryFill = applyEntrySlippage(rawEntryPrice, cost);
  const exitFill = applyExitSlippage(rawExitPrice, cost);
  const slippageCost = (entryFill - rawEntryPrice) * shares
                     + (rawExitPrice - exitFill) * shares;
  return slippageCost + cost.commissionPerTrade * 2;
}
