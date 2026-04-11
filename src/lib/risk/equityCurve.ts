export type SystemState = "NORMAL" | "CAUTION" | "PAUSE";

export interface SnapshotInput {
  date: Date | string;
  balance: number;
}

export interface EquityCurveState {
  currentBalance: number;
  peakBalance: number;
  drawdownPct: number;
  drawdownAbs: number;

  equityMA20: number | null;
  aboveEquityMA: boolean;

  systemState: SystemState;
  riskMultiplier: number;
  maxPositions: number;
  riskPctPerTrade: number;

  reason: string;
  triggeredAt: string | null;

  earlyRecoveryActive: boolean;
  consecutiveUpDays: number;
}

import { config } from "@/lib/config";

// Thresholds
const CAUTION_DRAWDOWN_PCT = config.cautionDrawdownPct;
const PAUSE_DRAWDOWN_PCT = config.pauseDrawdownPct;
const RECOVERY_SNAPSHOTS = 3;

/**
 * Calculate the equity curve state from account snapshots.
 * Determines whether the system should operate normally, with caution, or pause.
 * Supports early recovery: if balance is rising for 3+ consecutive snapshots
 * and drawdown is near the recovery threshold, transitions early.
 */
export function calculateEquityCurveState(
  snapshots: SnapshotInput[],
  baseRiskPct: number = 2.0,
  baseMaxPositions: number = 5,
  earlyPauseToCautionPct: number = 22.0,
  earlyCautionToNormalPct: number = 12.0,
): EquityCurveState {
  if (snapshots.length === 0) {
    return {
      currentBalance: 0,
      peakBalance: 0,
      drawdownPct: 0,
      drawdownAbs: 0,
      equityMA20: null,
      aboveEquityMA: true,
      systemState: "NORMAL",
      riskMultiplier: 1.0,
      maxPositions: baseMaxPositions,
      riskPctPerTrade: baseRiskPct,
      reason: "No history — operating normally",
      triggeredAt: null,
      earlyRecoveryActive: false,
      consecutiveUpDays: 0,
    };
  }

  const currentBalance = snapshots[snapshots.length - 1]!.balance;
  const peakBalance = Math.max(...snapshots.map((s) => s.balance));

  const drawdownAbs = peakBalance - currentBalance;
  const drawdownPct = peakBalance > 0 ? (drawdownAbs / peakBalance) * 100 : 0;

  // 20-period equity curve MA (need at least 5 points)
  const last20 = snapshots.slice(-20);
  const equityMA20 =
    last20.length >= 5
      ? last20.reduce((sum, s) => sum + s.balance, 0) / last20.length
      : null;

  const aboveEquityMA = equityMA20 !== null ? currentBalance >= equityMA20 : true;

  // Count consecutive rising balance snapshots (from most recent)
  let consecutiveUpDays = 0;
  if (snapshots.length >= 2) {
    for (let i = snapshots.length - 1; i >= 1; i--) {
      if (snapshots[i]!.balance > snapshots[i - 1]!.balance) {
        consecutiveUpDays++;
      } else {
        break;
      }
    }
  }

  // Determine system state
  let systemState: SystemState;
  let riskMultiplier: number;
  let maxPositions: number;
  let riskPctPerTrade: number;
  let reason: string;
  let earlyRecoveryActive = false;

  if (drawdownPct >= PAUSE_DRAWDOWN_PCT) {
    systemState = "PAUSE";
    riskMultiplier = 0;
    maxPositions = 0;
    riskPctPerTrade = 0;
    reason = `Account down ${drawdownPct.toFixed(1)}% from peak — new entries paused`;

    // Early recovery: PAUSE → CAUTION
    if (consecutiveUpDays >= 3 && drawdownPct < earlyPauseToCautionPct) {
      systemState = "CAUTION";
      riskMultiplier = 0.5;
      maxPositions = 3;
      riskPctPerTrade = baseRiskPct * 0.5;
      earlyRecoveryActive = true;
      reason = `Early recovery — ${consecutiveUpDays} consecutive up days, drawdown ${drawdownPct.toFixed(1)}% < ${earlyPauseToCautionPct}% threshold → PAUSE → CAUTION`;
    }
  } else if (drawdownPct >= CAUTION_DRAWDOWN_PCT || !aboveEquityMA) {
    systemState = "CAUTION";
    riskMultiplier = 0.5;
    maxPositions = 3;
    riskPctPerTrade = baseRiskPct * 0.5;

    if (drawdownPct >= CAUTION_DRAWDOWN_PCT && !aboveEquityMA) {
      reason = `Account down ${drawdownPct.toFixed(1)}% from peak AND below 20-day equity MA — reduced risk`;
    } else if (drawdownPct >= CAUTION_DRAWDOWN_PCT) {
      reason = `Account down ${drawdownPct.toFixed(1)}% from peak — reduced risk`;
    } else {
      reason = "Account below 20-day equity MA — reduced risk";
    }

    // Early recovery: CAUTION → NORMAL
    if (consecutiveUpDays >= 3 && drawdownPct < earlyCautionToNormalPct && aboveEquityMA) {
      systemState = "NORMAL";
      riskMultiplier = 1.0;
      maxPositions = baseMaxPositions;
      riskPctPerTrade = baseRiskPct;
      earlyRecoveryActive = true;
      reason = `Early recovery — ${consecutiveUpDays} consecutive up days, drawdown ${drawdownPct.toFixed(1)}% < ${earlyCautionToNormalPct}%, above MA20 → CAUTION → NORMAL`;
    }
  } else {
    systemState = "NORMAL";
    riskMultiplier = 1.0;
    maxPositions = baseMaxPositions;
    riskPctPerTrade = baseRiskPct;
    reason = "Account healthy — full risk active";
  }

  return {
    currentBalance,
    peakBalance,
    drawdownPct,
    drawdownAbs,
    equityMA20,
    aboveEquityMA,
    systemState,
    riskMultiplier,
    maxPositions,
    riskPctPerTrade,
    reason,
    triggeredAt: null,
    earlyRecoveryActive,
    consecutiveUpDays,
  };
}

/**
 * Check if the system should recover from a degraded state.
 * Requires the recovery condition to hold for RECOVERY_SNAPSHOTS consecutive snapshots.
 */
export function shouldRecover(
  snapshots: SnapshotInput[],
  currentState: SystemState,
  baseRiskPct: number = 2.0,
  baseMaxPositions: number = 5,
): boolean {
  if (snapshots.length < RECOVERY_SNAPSHOTS) return false;
  if (currentState === "NORMAL") return false;

  const lastN = snapshots.slice(-RECOVERY_SNAPSHOTS);

  return lastN.every((_, idx) => {
    const slice = snapshots.slice(0, snapshots.length - RECOVERY_SNAPSHOTS + idx + 1);
    const state = calculateEquityCurveState(slice, baseRiskPct, baseMaxPositions);

    if (currentState === "PAUSE") {
      // PAUSE → CAUTION: drawdown below 20%
      return state.drawdownPct < PAUSE_DRAWDOWN_PCT;
    }
    // CAUTION → NORMAL: drawdown below 10% AND above equity MA
    return state.drawdownPct < CAUTION_DRAWDOWN_PCT && state.aboveEquityMA;
  });
}
