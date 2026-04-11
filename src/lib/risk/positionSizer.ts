import type { VolumeSignal } from "@/lib/signals/volumeSignal";
import { config } from "@/lib/config";
import type { EquityCurveState } from "./equityCurve";

export interface PositionSize {
  ticker: string;
  shares: number;
  suggestedEntry: number;
  hardStop: number;
  dollarRisk: number;
  riskPerShare: number;
  totalExposure: number;
  exposurePercent: number;
  exposureWarning: string | null;
  equityState: string | null;
  effectiveRiskPct: number;
  wasCapped: boolean;
  cappedFrom: number | null;
}

/**
 * Size a position based on configured risk % and ATR-derived riskPerShare.
 * riskPerShare is computed as config.hardStopAtrMultiple × ATR-20,
 * ensuring alignment with the hard stop engine.
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

  // Compute riskPerShare from config ATR multiplier — aligns with volumeSignal hardStop
  const riskPerShare = config.hardStopAtrMultiple * signal.atr20;
  const hardStop = signal.suggestedEntry - riskPerShare;

  let shares = Math.round((dollarRisk / riskPerShare) * 10000) / 10000;

  const totalExposure = shares * signal.suggestedEntry;

  if (totalExposure < 1) return null;

  // Exposure cap — hard limit at 25% of account
  const MAX_EXPOSURE_PCT = 0.25;
  const maxExposure = accountBalance * MAX_EXPOSURE_PCT;
  let wasCapped = false;
  let cappedFrom: number | null = null;

  if (totalExposure > maxExposure) {
    cappedFrom = shares;
    shares = Math.round((maxExposure / signal.suggestedEntry) * 10000) / 10000;
    wasCapped = true;
    console.log(
      `[PositionSizer] Exposure cap applied — ` +
      `reduced from ${cappedFrom} to ${shares} shares ` +
      `(25% account limit)`,
    );
  }

  const finalExposure = shares * signal.suggestedEntry;
  const exposurePercent = finalExposure / accountBalance;
  const exposureWarning = exposurePercent > MAX_EXPOSURE_PCT
    ? `HIGH EXPOSURE — ${(exposurePercent * 100).toFixed(1)}% of account in one position`
    : null;

  // Detailed position size logging
  console.log(
    `[PositionSizer] ${signal.ticker}\n` +
    `  Balance: £${accountBalance} | Risk: ${(effectiveRiskPct * 100).toFixed(1)}% → £${dollarRisk.toFixed(2)} at risk\n` +
    `  Entry: $${signal.suggestedEntry} | ATR: $${signal.atr20.toFixed(2)} | Multiplier: ${config.hardStopAtrMultiple}×\n` +
    `  Hard stop: $${hardStop.toFixed(2)} | Risk/share: $${riskPerShare.toFixed(2)}\n` +
    `  Shares: ${shares} | Exposure: $${finalExposure.toFixed(2)} (${(exposurePercent * 100).toFixed(1)}% of account)`,
  );

  return {
    ticker: signal.ticker,
    shares,
    suggestedEntry: signal.suggestedEntry,
    hardStop,
    dollarRisk,
    riskPerShare,
    totalExposure: finalExposure,
    exposurePercent,
    exposureWarning,
    equityState: equityCurveState?.systemState ?? null,
    // Display value as percentage (e.g. 2.0 = 2%)
    effectiveRiskPct: equityCurveState?.riskPctPerTrade ?? (config.riskPctPerTrade * 100),
    wasCapped,
    cappedFrom,
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
