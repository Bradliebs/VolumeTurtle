// Performance metrics for backtest results.
//
// All functions are pure and operate on plain arrays so they can be unit-tested
// without database access. Annualisation assumes ~252 trading days per year.

import type {
  BacktestSummary,
  DailyEquityPoint,
  SimTrade,
} from "./types";

const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE_RATE = 0; // Daily equivalent assumed 0 for retail systems

/**
 * Convert a series of equity points to daily simple returns.
 * Returns one fewer element than input (no return for the first day).
 */
export function toDailyReturns(curve: DailyEquityPoint[]): number[] {
  if (curve.length < 2) return [];
  const out: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]!.equity;
    const cur = curve[i]!.equity;
    if (prev <= 0) {
      out.push(0);
      continue;
    }
    out.push((cur - prev) / prev);
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Annualised Sharpe ratio. Returns 0 if std dev is zero (avoids Infinity).
 */
export function sharpe(returns: number[], riskFree = RISK_FREE_RATE): number {
  if (returns.length < 2) return 0;
  const excess = returns.map((r) => r - riskFree);
  const sd = stdev(excess);
  if (sd === 0) return 0;
  return (mean(excess) / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/**
 * Sortino — like Sharpe but penalises only downside volatility.
 */
export function sortino(returns: number[], riskFree = RISK_FREE_RATE): number {
  if (returns.length < 2) return 0;
  const excess = returns.map((r) => r - riskFree);
  const downside = excess.filter((r) => r < 0);
  if (downside.length === 0) return 0;
  const dsd = Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / downside.length);
  if (dsd === 0) return 0;
  return (mean(excess) / dsd) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

export interface DrawdownStats {
  maxDrawdownPct: number;
  maxDrawdownDays: number;
}

/**
 * Peak-to-trough max drawdown (as positive percent) and longest underwater
 * period in trading days.
 */
export function maxDrawdown(curve: DailyEquityPoint[]): DrawdownStats {
  if (curve.length === 0) return { maxDrawdownPct: 0, maxDrawdownDays: 0 };
  let peak = curve[0]!.equity;
  let maxDD = 0;
  let underwaterDays = 0;
  let maxUnderwaterDays = 0;
  // Start at index 1: the first point sets the initial peak and is by
  // definition not underwater (a peak >= itself).
  for (let i = 1; i < curve.length; i++) {
    const point = curve[i]!;
    if (point.equity >= peak) {
      peak = point.equity;
      underwaterDays = 0;
    } else {
      underwaterDays++;
      if (underwaterDays > maxUnderwaterDays) maxUnderwaterDays = underwaterDays;
    }
    const dd = peak > 0 ? (peak - point.equity) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return { maxDrawdownPct: maxDD * 100, maxDrawdownDays: maxUnderwaterDays };
}

/**
 * Profit factor = sum(wins) / sum(|losses|). Returns Infinity-safe value.
 */
export function profitFactor(trades: SimTrade[]): number {
  let grossWin = 0;
  let grossLoss = 0;
  for (const t of trades) {
    const pnl = t.pnlNet ?? 0;
    if (pnl > 0) grossWin += pnl;
    else if (pnl < 0) grossLoss += -pnl;
  }
  if (grossLoss === 0) return grossWin > 0 ? Number.POSITIVE_INFINITY : 0;
  return grossWin / grossLoss;
}

/**
 * Mean R-multiple per trade — the truest single measure of edge.
 */
export function expectancyR(trades: SimTrade[]): number {
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => typeof r === "number");
  return mean(rs);
}

export function winRate(trades: SimTrade[]): number {
  if (trades.length === 0) return 0;
  const wins = trades.filter((t) => (t.pnlNet ?? 0) > 0).length;
  return wins / trades.length;
}

/**
 * CAGR from start equity, end equity, and elapsed calendar years.
 */
export function cagrPct(initial: number, final: number, years: number): number {
  if (initial <= 0 || years <= 0) return 0;
  return (Math.pow(final / initial, 1 / years) - 1) * 100;
}

/**
 * Build a complete summary from trades + equity curve.
 */
export function summarise(
  trades: SimTrade[],
  curve: DailyEquityPoint[],
  initialCapital: number,
): BacktestSummary {
  const closed = trades.filter((t) => t.exitDate);
  const wins = closed.filter((t) => (t.pnlNet ?? 0) > 0).length;
  const losses = closed.filter((t) => (t.pnlNet ?? 0) <= 0).length;
  const finalEquity = curve.length > 0 ? curve[curve.length - 1]!.equity : initialCapital;
  const totalReturnPct = initialCapital > 0
    ? ((finalEquity - initialCapital) / initialCapital) * 100
    : 0;

  // CAGR uses CALENDAR elapsed years, computed from the actual first/last
  // dates in the equity curve. Using `curve.length / 252` is wrong: it counts
  // only trading days the engine produced output for, which can be much less
  // than 252/year on sparse universes — and inflates CAGR dramatically.
  let years = 0;
  let actualStartDate: string | null = null;
  let actualEndDate: string | null = null;
  if (curve.length > 0) actualStartDate = curve[0]!.date;
  if (curve.length > 0) actualEndDate = curve[curve.length - 1]!.date;
  if (curve.length > 1) {
    const ms = new Date(actualEndDate!).getTime() - new Date(actualStartDate!).getTime();
    years = ms / (365.25 * 24 * 60 * 60 * 1000);
  }
  const dailyRets = toDailyReturns(curve);
  const dd = maxDrawdown(curve);

  return {
    trades: closed.length,
    wins,
    losses,
    winRate: winRate(closed),
    profitFactor: profitFactor(closed),
    expectancyR: expectancyR(closed),
    totalReturnPct,
    cagrPct: cagrPct(initialCapital, finalEquity, years),
    sharpe: sharpe(dailyRets),
    sortino: sortino(dailyRets),
    maxDrawdownPct: dd.maxDrawdownPct,
    maxDrawdownDays: dd.maxDrawdownDays,
    finalEquity,
    actualStartDate,
    actualEndDate,
    actualYears: years,
  };
}
