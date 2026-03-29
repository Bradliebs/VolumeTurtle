import type { DailyQuote } from "@/lib/data/fetchQuotes";

/**
 * True Range = max of:
 *   curr.high - curr.low
 *   |curr.high - prev.close|
 *   |curr.low  - prev.close|
 */
export function calculateTrueRange(prev: DailyQuote, curr: DailyQuote): number {
  return Math.max(
    curr.high - curr.low,
    Math.abs(curr.high - prev.close),
    Math.abs(curr.low - prev.close),
  );
}

/**
 * ATR using Wilder's smoothing method.
 * Uses all available data down to a minimum of 5 candles.
 * Returns null if there are fewer than 6 quotes (need at least 5 true ranges).
 */
export function calculateATR(
  quotes: DailyQuote[],
  period: number = 14,
): number | null {
  // Need at least 6 quotes for 5 true ranges (minimum useful ATR)
  if (quotes.length < 6) return null;

  // Use the requested period or all available data, whichever is smaller
  const effectivePeriod = Math.min(period, quotes.length - 1);

  // Initial ATR: simple average of the first `effectivePeriod` true ranges
  let atr = 0;
  for (let i = 1; i <= effectivePeriod; i++) {
    atr += calculateTrueRange(quotes[i - 1]!, quotes[i]!);
  }
  atr /= effectivePeriod;

  // Wilder's smoothing for remaining bars
  for (let i = effectivePeriod + 1; i < quotes.length; i++) {
    const tr = calculateTrueRange(quotes[i - 1]!, quotes[i]!);
    atr = (atr * (effectivePeriod - 1) + tr) / effectivePeriod;
  }

  return atr;
}

import { config } from "@/lib/config";

/**
 * ATR with the configured period — the primary ATR used for position sizing in VolumeTurtle.
 */
export function calculateATR20(quotes: DailyQuote[]): number | null {
  return calculateATR(quotes, config.atrPeriod);
}
