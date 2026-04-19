import type { DailyQuote } from "@/lib/data/fetchQuotes";
import { config } from "@/lib/config";

export interface OpenPosition {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  shares: number;
  hardStop: number;
  trailingStop: number;
  currentStop: number;
}

/**
 * Lowest close over the trailing stop window, excluding today (the final element).
 * Returns null when insufficient data — callers must handle the null case.
 */
export function calculateTrailingLow(quotes: DailyQuote[]): number | null {
  const days = config.trailingStopDays;
  const window = quotes.slice(-(days + 1), -1);
  if (window.length === 0) return null;
  return Math.min(...window.map((q) => q.close));
}

/**
 * Returns true if currentClose < the trailing low.
 * This is the sole mechanical exit rule for the nightly scan.
 *
 * NOTE: comparison is strict (`<`), not `<=`. A close that exactly equals
 * the trailing low does NOT trigger an exit. This is intentional and is
 * locked in by the test "returns false when currentClose equals trailing low".
 * The trailing window ALSO excludes today (see calculateTrailingLow), so the
 * semantic is: "today's close broke below the lowest close of the prior N days".
 *
 * Returns false when insufficient data (no trailing low to compare).
 */
export function shouldExit(
  currentClose: number,
  quotes: DailyQuote[],
): boolean {
  const trailingLow = calculateTrailingLow(quotes);
  if (trailingLow === null) return false;
  return currentClose < trailingLow;
}

/**
 * Find the highest close since the position was opened.
 * Returns null when no quotes fall on or after the entry date.
 */
export function findHighestCloseSinceEntry(
  entryDate: string,
  quotes: DailyQuote[],
): number | null {
  const entryTime = new Date(entryDate).getTime();
  let highest: number | null = null;
  for (const q of quotes) {
    if (new Date(q.date).getTime() >= entryTime) {
      if (highest === null || q.close > highest) {
        highest = q.close;
      }
    }
  }
  return highest;
}

/**
 * R-multiple stop ladder with ATR trailing.
 *
 * STOP LADDER (one-way checkpoints):
 *   - Below 1R profit → hardStop holds
 *   - At ~1R profit    → breakeven (entry price)
 *   - At ~2R profit    → lock in ~1R (entry + riskPerShare)
 *   - At ~3R+ profit   → ATR trail: highestClose - (atr × trailMultiplier)
 *
 * MONOTONIC CONSTRAINT: the returned stop is never below the position's
 * current trailingStop. Once a level is reached, it never goes back down.
 *
 * ATR TRAILING: The anchor (highestClose) ratchets upward only — it is
 * derived from quote history and never resets. If ATR expands, the stop
 * is NOT pulled back; the monotonic constraint holds.
 */
export function calculateLadderStop(
  position: OpenPosition,
  quotes: DailyQuote[],
  atr: number | null,
): number {
  const riskPerShare = position.entryPrice - position.hardStop;
  if (riskPerShare <= 0) return position.trailingStop;

  const highestClose = findHighestCloseSinceEntry(position.entryDate, quotes);
  if (highestClose === null) return position.trailingStop;

  const maxR = (highestClose - position.entryPrice) / riskPerShare;

  let ladderStop = position.hardStop;

  if (maxR >= 3 && atr !== null) {
    // ATR trailing from highest close, floored at the 1R lock
    const atrTrail = highestClose - (atr * config.trailAtrMultiple);
    const oneRLock = position.entryPrice + riskPerShare;
    ladderStop = Math.max(oneRLock, atrTrail);
    // Guard: stop must never be above current price (can happen with expanded ATR)
    const currentClose = quotes.length > 0 ? quotes[quotes.length - 1]!.close : highestClose;
    if (ladderStop >= currentClose) {
      ladderStop = currentClose * 0.99;
    }
  } else if (maxR >= 2) {
    // Lock in ~1R
    ladderStop = position.entryPrice + riskPerShare;
  } else if (maxR >= 1) {
    // Breakeven
    ladderStop = position.entryPrice;
  }

  // Monotonic: never decrease from current trailing stop
  return Math.max(position.trailingStop, ladderStop);
}

/**
 * Returns the updated trailing stop level.
 * Uses the R-multiple ladder with ATR trailing.
 * The stop only ratchets up — never decreases.
 * When data is insufficient, returns the current trailing stop unchanged.
 */
export function updateTrailingStop(
  position: OpenPosition,
  quotes: DailyQuote[],
  atr?: number | null,
): number {
  return calculateLadderStop(position, quotes, atr ?? null);
}
