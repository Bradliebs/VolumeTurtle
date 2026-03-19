import type { VolumeSignal } from "@/lib/signals/volumeSignal";
import { config } from "@/lib/config";
import type { EquityCurveState } from "./equityCurve";

export interface PositionSize {
  ticker: string;
  shares: number;
  suggestedEntry: number;
  hardStop: number;
  dollarRisk: number;
  totalExposure: number;
  exposurePercent: number;
  exposureWarning: string | null;
  equityState: string | null;
  effectiveRiskPct: number;
}

/**
 * Size a position based on configured risk % and the signal's riskPerShare.
 * If an equityCurveState is provided, uses adjusted risk parameters.
 * Returns null if the total exposure is less than £1 or system is PAUSED.
 * Supports fractional shares (Trading 212).
 */
export function calculatePositionSize(
  signal: VolumeSignal,
  accountBalance: number,
  equityCurveState?: EquityCurveState,
): PositionSize | null {
  // If PAUSE state — no new positions
  if (equityCurveState?.systemState === "PAUSE") {
    return null;
  }

  const effectiveRiskPct = equityCurveState
    ? equityCurveState.riskPctPerTrade / 100
    : config.riskPctPerTrade;

  const dollarRisk = accountBalance * effectiveRiskPct;
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
    equityState: equityCurveState?.systemState ?? null,
    // Display value as percentage (e.g. 2.0 = 2%)
    effectiveRiskPct: equityCurveState?.riskPctPerTrade ?? (config.riskPctPerTrade * 100),
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
