import type { VolumeSignal } from "@/lib/signals/volumeSignal";
import { config } from "@/lib/config";

export interface PositionSize {
  ticker: string;
  shares: number;
  suggestedEntry: number;
  hardStop: number;
  dollarRisk: number;
  totalExposure: number;
  exposurePercent: number;
  exposureWarning: string | null;
}

/**
 * Size a position based on configured risk % and the signal's riskPerShare.
 * Returns null if the total exposure is less than £1.
 * Supports fractional shares (Trading 212).
 */
export function calculatePositionSize(
  signal: VolumeSignal,
  accountBalance: number,
): PositionSize | null {
  const dollarRisk = accountBalance * config.riskPctPerTrade;
  const shares = Math.round((dollarRisk / signal.riskPerShare) * 10000) / 10000;

  const totalExposure = shares * signal.suggestedEntry;

  if (totalExposure < 1) return null;

  const MAX_EXPOSURE_PCT = 0.25;
  const exposurePercent = totalExposure / accountBalance;
  const exposureWarning = exposurePercent > MAX_EXPOSURE_PCT
    ? `HIGH EXPOSURE — ${(exposurePercent * 100).toFixed(1)}% of account in one position`
    : null;

  return {
    ticker: signal.ticker,
    shares,
    suggestedEntry: signal.suggestedEntry,
    hardStop: signal.hardStop,
    dollarRisk,
    totalExposure,
    exposurePercent,
    exposureWarning,
  };
}

/**
 * Returns false if we already have maxAllowed or more open positions.
 */
export function checkMaxPositions(
  openPositions: number,
  maxAllowed: number = config.maxPositions,
): boolean {
  return openPositions < maxAllowed;
}
