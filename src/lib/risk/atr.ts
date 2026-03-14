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
 * Returns null if there are fewer than period+1 quotes.
 */
export function calculateATR(
  quotes: DailyQuote[],
  period: number = 14,
): number | null {
  if (quotes.length < period + 1) return null;

  // Initial ATR: simple average of the first `period` true ranges
  let atr = 0;
  for (let i = 1; i <= period; i++) {
    atr += calculateTrueRange(quotes[i - 1]!, quotes[i]!);
  }
  atr /= period;

  // Wilder's smoothing for remaining bars
  for (let i = period + 1; i < quotes.length; i++) {
    const tr = calculateTrueRange(quotes[i - 1]!, quotes[i]!);
    atr = (atr * (period - 1) + tr) / period;
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
