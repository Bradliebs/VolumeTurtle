/**
 * Cruise Control — Stop Ratchet Calculator
 *
 * Pure calculation logic. No side effects.
 * Takes current position data + current price, returns new stop level or null.
 *
 * THE MONOTONIC RULE: stops can ONLY move up — never down.
 * This is absolute and non-negotiable.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type PositionType = "momentum" | "pead" | "pairs-long";

export interface RatchetInput {
  positionType: PositionType;
  entryPrice: number;
  currentStop: number;
  currentPrice: number;
  atr: number;
  /** Days since entry — used for PEAD time-decay tightening */
  daysSinceEntry?: number;
}

// ── Monotonic Guard ─────────────────────────────────────────────────────────

/**
 * MONOTONIC GUARD — the absolute, non-negotiable rule.
 * newStop must be strictly greater than currentStop.
 * Returns newStop if valid, null otherwise.
 */
export function MONOTONIC_GUARD(
  newStop: number,
  currentStop: number,
): number | null {
  if (newStop <= currentStop) return null;
  return newStop;
}

// ── Minimum Movement Threshold ──────────────────────────────────────────────

const MIN_MOVEMENT_PCT = 0.001; // 0.1%

/**
 * Returns true if the movement is too small to bother updating T212.
 */
function belowMinimumThreshold(newStop: number, currentStop: number): boolean {
  if (currentStop <= 0) return false;
  const threshold = currentStop * MIN_MOVEMENT_PCT;
  return (newStop - currentStop) < threshold;
}

// ── Ratchet Calculations per Position Type ──────────────────────────────────

function ratchetMomentum(
  entryPrice: number,
  currentStop: number,
  currentPrice: number,
  atr: number,
): number | null {
  const profitPct = ((currentPrice - entryPrice) / entryPrice) * 100;

  let rawStop: number;

  if (profitPct >= 50) {
    // Full trailing stop
    rawStop = currentPrice - 1.5 * atr;
  } else if (profitPct >= 30) {
    // Trail aggressively
    rawStop = entryPrice + 2.0 * atr;
  } else if (profitPct >= 20) {
    // Lock in meaningful gain
    rawStop = entryPrice + 1.0 * atr;
  } else if (profitPct >= 10) {
    // Lock in small gain
    rawStop = entryPrice + 0.5 * atr;
  } else if (profitPct >= 5) {
    // Breakeven stop
    rawStop = entryPrice;
  } else {
    // Initial stop — protect capital
    rawStop = entryPrice - 1.5 * atr;
  }

  // Ensure we never go below current stop (local max before guard)
  const candidateStop = Math.max(rawStop, currentStop);
  return candidateStop;
}

function ratchetPead(
  entryPrice: number,
  currentStop: number,
  currentPrice: number,
  atr: number,
  daysSinceEntry: number,
): number | null {
  const profitPct = ((currentPrice - entryPrice) / entryPrice) * 100;

  let rawStop: number;

  if (profitPct >= 10) {
    // Tighter trail
    rawStop = currentPrice - 1.0 * atr;
  } else if (profitPct >= 5) {
    // Faster to breakeven
    rawStop = entryPrice + 0.25 * atr;
  } else {
    // Tighter initial stop
    rawStop = entryPrice - 1.0 * atr;
  }

  // Time-decay tightening for days 40–60
  if (daysSinceEntry >= 40 && daysSinceEntry <= 60) {
    rawStop += 0.25 * atr;
  }

  const candidateStop = Math.max(rawStop, currentStop);
  return candidateStop;
}

function ratchetPairsLong(
  entryPrice: number,
  currentStop: number,
  currentPrice: number,
  atr: number,
): number | null {
  const profitPct = ((currentPrice - entryPrice) / entryPrice) * 100;

  // Only ratchet if profit on long leg exceeds 5%
  if (profitPct <= 5) return null;

  // Simple 2×ATR trailing from entry price (secondary guard)
  const rawStop = entryPrice - 2.0 * atr;
  const candidateStop = Math.max(rawStop, currentStop);
  return candidateStop;
}

// ── Main Export ──────────────────────────────────────────────────────────────

/**
 * Calculate the ratcheted stop for any position type.
 * Returns the new stop price, or null if no ratchet is needed.
 *
 * Every code path passes through MONOTONIC_GUARD before returning.
 */
export function calculateRatchetedStop(input: RatchetInput): number | null {
  const {
    positionType,
    entryPrice,
    currentStop,
    currentPrice,
    atr,
    daysSinceEntry = 0,
  } = input;

  // Sanity: skip if inputs are invalid
  if (atr <= 0 || currentPrice <= 0 || entryPrice <= 0) return null;

  let candidateStop: number | null;

  switch (positionType) {
    case "momentum":
      candidateStop = ratchetMomentum(entryPrice, currentStop, currentPrice, atr);
      break;
    case "pead":
      candidateStop = ratchetPead(entryPrice, currentStop, currentPrice, atr, daysSinceEntry);
      break;
    case "pairs-long":
      candidateStop = ratchetPairsLong(entryPrice, currentStop, currentPrice, atr);
      break;
    default:
      return null;
  }

  if (candidateStop == null) return null;

  // Check minimum movement threshold
  if (belowMinimumThreshold(candidateStop, currentStop)) return null;

  // MONOTONIC GUARD — the final, absolute check
  return MONOTONIC_GUARD(candidateStop, currentStop);
}
