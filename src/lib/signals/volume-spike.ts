import type { HistoricalBar } from "@/lib/data";
import type { SignalResult } from "./types";

/**
 * Detect a volume spike: today's volume > `multiplier` × average of
 * the previous `lookback` sessions.
 */
export function detectVolumeSpike(
  symbol: string,
  bars: HistoricalBar[],
  options: { lookback?: number; multiplier?: number } = {},
): SignalResult | null {
  const lookback = options.lookback ?? 20;
  const multiplier = options.multiplier ?? 2.0;

  if (bars.length < lookback + 1) return null;

  const recent = bars.slice(-lookback - 1);
  const today = recent[recent.length - 1];
  if (!today) return null;

  const avgVolume =
    recent.slice(0, lookback).reduce((sum, b) => sum + b.volume, 0) / lookback;

  if (avgVolume === 0) return null;

  const ratio = today.volume / avgVolume;

  if (ratio >= multiplier) {
    return {
      symbol,
      date: today.date,
      type: "VOLUME_SPIKE",
      strength: Math.min(ratio / (multiplier * 2), 1),
      metadata: {
        volume: today.volume,
        avgVolume: Math.round(avgVolume),
        ratio: Math.round(ratio * 100) / 100,
      },
    };
  }

  return null;
}
