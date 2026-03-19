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
 * This is the sole mechanical exit rule.
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
 * Returns the updated trailing stop level.
 * The stop only ratchets up — if the new 10-day low is below the
 * current trailing stop, the current stop is returned unchanged.
 * When data is insufficient, returns the current trailing stop unchanged.
 */
export function updateTrailingStop(
  position: OpenPosition,
  quotes: DailyQuote[],
): number {
  const newStop = calculateTrailingLow(quotes);
  if (newStop === null) return position.trailingStop;
  return Math.max(position.trailingStop, newStop);
}
