// Backtest core types — kept dependency-light so the engine and metrics
// modules can be unit-tested without Prisma or the full app context.

import type { DailyQuote } from "@/lib/data/fetchQuotes";

export type EngineKind = "volume" | "momentum";

export interface CostModel {
  /** Flat commission per fill (entry or exit), in account currency. */
  commissionPerTrade: number;
  /** Slippage in basis points applied against the trader on each fill. */
  slippageBps: number;
  /** Bid/ask half-spread in bps applied against the trader on each fill. */
  spreadBps: number;
}

export interface BacktestParams {
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string;   // YYYY-MM-DD inclusive
  initialCapital: number;
  engine: EngineKind;
  cost: CostModel;
  /** Override: max % of equity risked per trade (decimal, e.g. 0.01 = 1%). */
  riskPctPerTrade?: number;
  /** Optional cap on simultaneously-open positions. */
  maxOpenPositions?: number;
  /** If true, drops backtest equity to zero on a single-day gap-down through stop. */
  modelGapRisk?: boolean;
  label?: string;

  // ── Tier 2 risk controls ──────────────────────────────────────────────
  /**
   * Conviction-weighted sizing: multiply per-trade risk by a factor based on
   * the composite-score grade (A is highest). When undefined, sizing is flat.
   * Typical: { A: 1.5, B: 1.2, C: 1.0, D: 0.6 }.
   */
  convictionMultipliers?: { A?: number; B?: number; C?: number; D?: number };
  /**
   * Hard ceiling on TOTAL open risk as a fraction of equity. Sum of
   * `(entry − stop) × shares` across open positions cannot exceed
   * `portfolioHeatCapPct × equity`. Blocks new entries that would breach.
   * Typical: 0.08 (8% of equity at risk simultaneously).
   */
  portfolioHeatCapPct?: number;
  /**
   * Sector concentration cap. Block a new entry if its sector already has
   * `>= maxPositionsPerSector` open positions. Requires sector lookup.
   */
  maxPositionsPerSector?: number;
}

export interface SimTrade {
  ticker: string;
  entryDate: string;
  entryPrice: number;     // post-slippage fill
  rawEntryPrice: number;  // close used as basis
  shares: number;
  hardStop: number;
  signalGrade: string | null;
  signalScore: number | null;
  volumeRatio: number | null;
  atr20: number;
  exitDate?: string;
  exitPrice?: number;     // post-slippage
  rawExitPrice?: number;
  exitReason?: "HARD_STOP" | "TRAILING_STOP" | "END_OF_BACKTEST";
  pnl?: number;
  pnlNet?: number;
  costs?: number;
  rMultiple?: number;
  barsHeld?: number;
}

export interface BacktestQuoteSet {
  ticker: string;
  /** Optional sector — used by `maxPositionsPerSector` concentration gate. */
  sector?: string | null;
  quotes: DailyQuote[];
}

export interface DailyEquityPoint {
  date: string;
  equity: number;
  openPositions: number;
  drawdownPct: number;
}

export interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  totalReturnPct: number;
  cagrPct: number;
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number;
  maxDrawdownDays: number;
  finalEquity: number;
  // Actual covered window — derived from the first/last point in the equity
  // curve. Tells the UI when the requested window was silently clamped by
  // missing historical data, so we don't surface a misleading CAGR.
  actualStartDate: string | null;
  actualEndDate: string | null;
  actualYears: number;
  // Tier-2 gate counters — diagnostic only. Lets the UI quantify how often
  // each risk control fired and rejected an otherwise-valid signal.
  blockedByHeatCap?: number;
  blockedBySectorCap?: number;
}

export interface BacktestResult {
  params: BacktestParams;
  summary: BacktestSummary;
  trades: SimTrade[];
  equityCurve: DailyEquityPoint[];
}
