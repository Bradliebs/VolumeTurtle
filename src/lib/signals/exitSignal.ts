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
 */
export function calculateTrailingLow(quotes: DailyQuote[]): number {
  const days = config.trailingStopDays;
  const window = quotes.slice(-(days + 1), -1);
  if (window.length === 0) return Infinity;
  return Math.min(...window.map((q) => q.close));
}

/**
 * Returns true if currentClose < the trailing low.
 * This is the sole mechanical exit rule.
 */
export function shouldExit(
  currentClose: number,
  quotes: DailyQuote[],
): boolean {
  return currentClose < calculateTrailingLow(quotes);
}

/**
 * Returns the updated trailing stop level.
 * The stop only ratchets up — if the new 10-day low is below the
 * current trailing stop, the current stop is returned unchanged.
 */
export function updateTrailingStop(
  position: OpenPosition,
  quotes: DailyQuote[],
): number {
  const newStop = calculateTrailingLow(quotes);
  return Math.max(position.trailingStop, newStop);
}
