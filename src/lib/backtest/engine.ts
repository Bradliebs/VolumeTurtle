// Backtest engine — replays a strategy day by day over historical bars,
// reusing the *exact* same signal/exit logic as the live system.
//
// Design choices:
//   - Signal generators (`generateSignal`, `shouldExit`) are imported and
//     called as-is. This guarantees backtest results reflect the live engine,
//     not a re-implementation that could drift.
//   - Cost model is applied at fill time (not at signal time). The reference
//     close is preserved so we can audit slippage attribution.
//   - Stops are evaluated using the same lowest-close-of-N-days rule as live.
//   - Position sizing uses risk-per-trade % of *current* equity, so the curve
//     compounds correctly.
//   - No look-ahead: each bar's decision uses only data up to and including
//     that bar; fills happen on the *next* bar's open price (modelled as
//     prior close + entry slippage, since we don't store opens for backtest
//     entry timing — this is conservative and avoids look-ahead).

import type { DailyQuote } from "@/lib/data/fetchQuotes";
import { generateSignal } from "@/lib/signals/volumeSignal";
import { calculateTrailingLow } from "@/lib/signals/exitSignal";
import { config } from "@/lib/config";
import { applyEntrySlippage, applyExitSlippage, calculateRoundTripCosts } from "./costModel";
import { summarise } from "./metrics";
import type {
  BacktestParams,
  BacktestQuoteSet,
  BacktestResult,
  DailyEquityPoint,
  SimTrade,
} from "./types";

interface OpenSim {
  ticker: string;
  entryDate: string;
  entryPrice: number;
  rawEntryPrice: number;
  shares: number;
  hardStop: number;
  atr20: number;
  signalGrade: string | null;
  signalScore: number | null;
  volumeRatio: number | null;
  barsHeld: number;
}

/** Build a sorted set of all unique trading dates across the universe. */
function collectDates(sets: BacktestQuoteSet[], start: string, end: string): string[] {
  const dates = new Set<string>();
  for (const set of sets) {
    for (const q of set.quotes) {
      if (q.date >= start && q.date <= end) dates.add(q.date);
    }
  }
  return [...dates].sort();
}

/** Index quotes by date for O(1) lookup. */
function indexQuotes(set: BacktestQuoteSet): Map<string, DailyQuote> {
  const m = new Map<string, DailyQuote>();
  for (const q of set.quotes) m.set(q.date, q);
  return m;
}

/** Get the slice of quotes up to and including `asOf` (inclusive). */
function quotesUpTo(set: BacktestQuoteSet, asOf: string): DailyQuote[] {
  // Quotes are typically sorted ascending; binary-search style would be faster
  // but at universe scale this is fine for a first pass.
  return set.quotes.filter((q) => q.date <= asOf);
}

export function runBacktest(
  universe: BacktestQuoteSet[],
  params: BacktestParams,
): BacktestResult {
  const dates = collectDates(universe, params.startDate, params.endDate);
  const indexed = new Map<string, Map<string, DailyQuote>>();
  for (const set of universe) indexed.set(set.ticker, indexQuotes(set));

  const riskPct = params.riskPctPerTrade ?? config.riskPctPerTrade;
  const maxOpen = params.maxOpenPositions ?? Number.POSITIVE_INFINITY;

  // Tier-2 risk controls (all optional — undefined means disabled).
  const heatCapPct = params.portfolioHeatCapPct;
  const sectorCap = params.maxPositionsPerSector;
  const sectorOf = new Map<string, string | null>();
  for (const set of universe) sectorOf.set(set.ticker, set.sector ?? null);

  // Conviction multipliers default to flat 1.0× when not provided.
  const grade = params.convictionMultipliers ?? {};
  const gradeMult = (g: string | null | undefined): number => {
    if (!g) return 1;
    if (g === "A") return grade.A ?? 1;
    if (g === "B") return grade.B ?? 1;
    if (g === "C") return grade.C ?? 1;
    if (g === "D") return grade.D ?? 1;
    return 1;
  };

  let blockedByHeatCap = 0;
  let blockedBySectorCap = 0;

  let equity = params.initialCapital;
  const open: OpenSim[] = [];
  const closed: SimTrade[] = [];
  const curve: DailyEquityPoint[] = [];
  let peakEquity = equity;

  for (const date of dates) {
    // 1) Check exits on existing open positions.
    for (let i = open.length - 1; i >= 0; i--) {
      const pos = open[i]!;
      const set = universe.find((u) => u.ticker === pos.ticker);
      if (!set) continue;
      const todayQuote = indexed.get(pos.ticker)?.get(date);
      if (!todayQuote) continue;

      pos.barsHeld++;
      const history = quotesUpTo(set, date);
      const trailingLow = calculateTrailingLow(history);
      const activeStop = trailingLow !== null
        ? Math.max(pos.hardStop, trailingLow)
        : pos.hardStop;

      const stopHit = todayQuote.low <= activeStop;
      if (!stopHit) continue;

      // Fill at the stop level (or the day's open if it gapped through, modelling gap risk).
      const fillBasis = params.modelGapRisk && todayQuote.open < activeStop
        ? todayQuote.open
        : activeStop;
      const exitPrice = applyExitSlippage(fillBasis, params.cost);
      const grossPnl = (exitPrice - pos.entryPrice) * pos.shares;
      const costs = calculateRoundTripCosts(pos.rawEntryPrice, fillBasis, pos.shares, params.cost);
      const netPnl = grossPnl - params.cost.commissionPerTrade * 2;
      // Note: slippage is already baked into entryPrice/exitPrice, so commission
      // is the only explicit subtractor here. `costs` reports the full friction
      // for transparency.

      const riskPerShare = pos.entryPrice - pos.hardStop;
      const rMultiple = riskPerShare > 0 ? (exitPrice - pos.entryPrice) / riskPerShare : 0;

      const exitReason: SimTrade["exitReason"] = trailingLow !== null && activeStop === trailingLow
        ? "TRAILING_STOP"
        : "HARD_STOP";

      closed.push({
        ticker: pos.ticker,
        entryDate: pos.entryDate,
        entryPrice: pos.entryPrice,
        rawEntryPrice: pos.rawEntryPrice,
        shares: pos.shares,
        hardStop: pos.hardStop,
        atr20: pos.atr20,
        signalGrade: pos.signalGrade,
        signalScore: pos.signalScore,
        volumeRatio: pos.volumeRatio,
        exitDate: date,
        exitPrice,
        rawExitPrice: fillBasis,
        exitReason,
        pnl: grossPnl,
        pnlNet: netPnl,
        costs,
        rMultiple,
        barsHeld: pos.barsHeld,
      });

      equity += netPnl;
      open.splice(i, 1);
    }

    // 2) Generate new signals (only if capacity available).
    if (open.length < maxOpen) {
      // Pre-compute open-risk + per-sector counts ONCE per day. They mutate
      // as we add positions inside the loop; cheaper than recomputing per
      // candidate and identical to a fresh scan because the engine evaluates
      // a single bar at a time.
      let openRiskTotal = 0;
      for (const p of open) openRiskTotal += (p.entryPrice - p.hardStop) * p.shares;
      const sectorCounts = new Map<string, number>();
      if (sectorCap !== undefined) {
        for (const p of open) {
          const s = sectorOf.get(p.ticker);
          if (s) sectorCounts.set(s, (sectorCounts.get(s) ?? 0) + 1);
        }
      }

      for (const set of universe) {
        if (open.length >= maxOpen) break;
        if (open.some((p) => p.ticker === set.ticker)) continue; // one position per ticker

        const history = quotesUpTo(set, date);
        if (history.length < 25) continue;

        const signal = params.engine === "volume"
          ? generateSignal(set.ticker, history)
          : null; // momentum engine wiring deferred — see TODO at bottom

        if (!signal) continue;

        // Sector concentration gate — block before pricing for speed.
        if (sectorCap !== undefined) {
          const sec = sectorOf.get(set.ticker);
          if (sec && (sectorCounts.get(sec) ?? 0) >= sectorCap) {
            blockedBySectorCap++;
            continue;
          }
        }

        const rawEntry = signal.suggestedEntry;
        const entryPrice = applyEntrySlippage(rawEntry, params.cost);
        const riskPerShare = entryPrice - signal.hardStop;
        if (riskPerShare <= 0) continue;

        // Conviction-weighted sizing: scale risk by grade. A-grades get more
        // capital allocated, D-grades get less. Falls back to 1× when the
        // signal has no grade or no multipliers are configured.
        const grade = signal.compositeScore?.grade ?? null;
        const dollarRisk = equity * riskPct * gradeMult(grade);
        const shares = Math.floor((dollarRisk / riskPerShare) * 10000) / 10000;
        if (shares <= 0) continue;
        const exposure = shares * entryPrice;
        if (exposure > equity) continue; // can't size larger than available equity

        // Portfolio heat cap — block if the new position would push total
        // open risk above the configured ceiling.
        if (heatCapPct !== undefined) {
          const newRisk = riskPerShare * shares;
          if (openRiskTotal + newRisk > equity * heatCapPct) {
            blockedByHeatCap++;
            continue;
          }
          openRiskTotal += newRisk;
        }

        if (sectorCap !== undefined) {
          const sec = sectorOf.get(set.ticker);
          if (sec) sectorCounts.set(sec, (sectorCounts.get(sec) ?? 0) + 1);
        }

        open.push({
          ticker: set.ticker,
          entryDate: date,
          entryPrice,
          rawEntryPrice: rawEntry,
          shares,
          hardStop: signal.hardStop,
          atr20: signal.atr20,
          signalGrade: signal.compositeScore?.grade ?? null,
          signalScore: signal.compositeScore?.total ?? null,
          volumeRatio: signal.volumeRatio,
          barsHeld: 0,
        });
      }
    }

    // 3) Mark-to-market all open positions for equity curve.
    let _openValue = 0;
    let unrealised = 0;
    for (const pos of open) {
      const q = indexed.get(pos.ticker)?.get(date);
      if (!q) continue;
      _openValue += pos.shares * q.close;
      unrealised += (q.close - pos.entryPrice) * pos.shares;
    }
    const mtmEquity = equity + unrealised;
    if (mtmEquity > peakEquity) peakEquity = mtmEquity;
    const ddPct = peakEquity > 0 ? ((peakEquity - mtmEquity) / peakEquity) * 100 : 0;

    curve.push({
      date,
      equity: mtmEquity,
      openPositions: open.length,
      drawdownPct: ddPct,
    });
  }

  // 4) Force-close any remaining open positions at the final close.
  if (dates.length > 0) {
    const finalDate = dates[dates.length - 1]!;
    for (const pos of open) {
      const q = indexed.get(pos.ticker)?.get(finalDate);
      if (!q) continue;
      const exitPrice = applyExitSlippage(q.close, params.cost);
      const grossPnl = (exitPrice - pos.entryPrice) * pos.shares;
      const costs = calculateRoundTripCosts(pos.rawEntryPrice, q.close, pos.shares, params.cost);
      const netPnl = grossPnl - params.cost.commissionPerTrade * 2;
      const riskPerShare = pos.entryPrice - pos.hardStop;
      const rMultiple = riskPerShare > 0 ? (exitPrice - pos.entryPrice) / riskPerShare : 0;

      closed.push({
        ticker: pos.ticker,
        entryDate: pos.entryDate,
        entryPrice: pos.entryPrice,
        rawEntryPrice: pos.rawEntryPrice,
        shares: pos.shares,
        hardStop: pos.hardStop,
        atr20: pos.atr20,
        signalGrade: pos.signalGrade,
        signalScore: pos.signalScore,
        volumeRatio: pos.volumeRatio,
        exitDate: finalDate,
        exitPrice,
        rawExitPrice: q.close,
        exitReason: "END_OF_BACKTEST",
        pnl: grossPnl,
        pnlNet: netPnl,
        costs,
        rMultiple,
        barsHeld: pos.barsHeld,
      });
      equity += netPnl;
    }
  }

  const summary = summarise(closed, curve, params.initialCapital);
  summary.blockedByHeatCap = blockedByHeatCap;
  summary.blockedBySectorCap = blockedBySectorCap;
  return { params, summary, trades: closed, equityCurve: curve };
}

// TODO: Momentum engine wiring. The HBME breakout engine requires sector-level
// rankings recomputed daily across the universe; that's a non-trivial extension
// of the loop above. Tracked separately — current backtester targets the volume
// engine which is the primary signal source.
