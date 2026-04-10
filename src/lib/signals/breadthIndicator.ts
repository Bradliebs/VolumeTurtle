// ═══════════════════════════════════════════════════
// breadthIndicator.ts
// Measures market health beyond QQQ and VIX.
// Uses PriceCache data — no additional Yahoo calls.
// Called once per scan, result stored in ScanRun.
// ═══════════════════════════════════════════════════

import { prisma } from "@/db/client";
import { getCachedQuotes } from "@/lib/data/quoteCache";
import { createLogger } from "@/lib/logger";

const log = createLogger("breadthIndicator");

// ── Types ──────────────────────────────────────────────────────────────────

export type BreadthSignal = "STRONG" | "NEUTRAL" | "WEAK" | "DETERIORATING";
export type BreadthTrend = "IMPROVING" | "STABLE" | "DECLINING";

export interface BreadthResult {
  above50MA: number;           // % of universe above 50d MA
  above200MA: number;          // % of universe above 200d MA
  above50MA_count: number;     // raw count
  above200MA_count: number;    // raw count
  totalMeasured: number;       // tickers with sufficient data
  newHighs: number;            // tickers at 52-week high
  newLows: number;             // tickers at 52-week low
  newHighLowRatio: number;     // newHighs / (newHighs + newLows) * 100
  advanceDecline: number;      // % of tickers up on the day
  breadthScore: number;        // composite 0-100
  breadthSignal: BreadthSignal;
  breadthTrend: BreadthTrend;
  warning: string | null;
}

// ── Prisma typed cast ──────────────────────────────────────────────────────

const db = prisma as unknown as {
  scanRun: {
    findFirst: (args: unknown) => Promise<{
      breadthScore: number | null;
    } | null>;
  };
};

// ── Helpers ────────────────────────────────────────────────────────────────

function sma(values: number[], period: number): number {
  const slice = values.slice(-period);
  if (slice.length === 0) return 0;
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

// ── Main ───────────────────────────────────────────────────────────────────

const MIN_CANDLES = 10;
const MIN_TICKERS_FOR_BREADTH = 100;

/**
 * Calculate market breadth from cached price data.
 * Returns null if insufficient cache (< 100 tickers with data).
 */
export async function calculateBreadth(
  universe: string[],
): Promise<BreadthResult | null> {
  const since = new Date();
  since.setDate(since.getDate() - 300); // ~252 trading days + buffer

  let above50MA_count = 0;
  let above200MA_count = 0;
  let totalMeasured = 0;
  let total200Eligible = 0;
  let newHighs = 0;
  let newLows = 0;
  let advances = 0;
  let declines = 0;

  // Load all cached quotes in parallel batches
  const batchSize = 50;
  const allQuotes: Map<string, Array<{ date: string; close: number; volume: number }>> = new Map();

  for (let i = 0; i < universe.length; i += batchSize) {
    const batch = universe.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (ticker) => {
        const quotes = await getCachedQuotes(ticker, since);
        return { ticker, quotes };
      }),
    );
    for (const { ticker, quotes } of results) {
      if (quotes.length >= MIN_CANDLES) {
        allQuotes.set(ticker, quotes);
      }
    }
  }

  if (allQuotes.size < MIN_TICKERS_FOR_BREADTH) {
    log.info(
      { tickersWithData: allQuotes.size, threshold: MIN_TICKERS_FOR_BREADTH },
      "Breadth skipped — insufficient cache",
    );
    return null;
  }

  for (const [, quotes] of allQuotes) {
    const closes = quotes.map((q) => q.close);
    const lastClose = closes[closes.length - 1]!;
    totalMeasured++;

    // ── Above 50-day MA ──
    const sma50Period = Math.min(50, closes.length);
    const sma50 = sma(closes, sma50Period);
    if (lastClose > sma50) above50MA_count++;

    // ── Above 200-day MA ──
    if (closes.length >= 100) {
      const sma200Period = Math.min(200, closes.length);
      const sma200 = sma(closes, sma200Period);
      total200Eligible++;
      if (lastClose > sma200) above200MA_count++;
    }

    // ── 52-week high/low ──
    const lookback = Math.min(252, closes.length);
    const recent = closes.slice(-lookback);
    const high52w = Math.max(...recent);
    const low52w = Math.min(...recent);
    if (lastClose >= high52w * 0.98) newHighs++;
    if (lastClose <= low52w * 1.02) newLows++;

    // ── Advance / Decline ──
    if (closes.length >= 2) {
      const prevClose = closes[closes.length - 2]!;
      if (lastClose > prevClose) advances++;
      else if (lastClose < prevClose) declines++;
    }
  }

  // ── Percentages ──
  const above50MA = totalMeasured > 0 ? (above50MA_count / totalMeasured) * 100 : 0;
  const above200MA = total200Eligible > 0 ? (above200MA_count / total200Eligible) * 100 : 0;
  const newHighLowRatio = (newHighs / Math.max(newHighs + newLows, 1)) * 100;
  const advanceDecline = (advances / Math.max(advances + declines, 1)) * 100;

  // ── Composite score (0-100) ──
  const breadthScore =
    above50MA * 0.35 +
    above200MA * 0.25 +
    newHighLowRatio * 0.25 +
    advanceDecline * 0.15;

  // ── Signal ──
  let breadthSignal: BreadthSignal;
  if (breadthScore >= 60 && above50MA >= 60) {
    breadthSignal = "STRONG";
  } else if (breadthScore >= 45 && above50MA >= 45) {
    breadthSignal = "NEUTRAL";
  } else if (breadthScore >= 30 && above50MA >= 30) {
    breadthSignal = "WEAK";
  } else {
    breadthSignal = "DETERIORATING";
  }

  // ── Trend vs previous scan ──
  let breadthTrend: BreadthTrend = "STABLE";
  try {
    const prev = await db.scanRun.findFirst({
      orderBy: { startedAt: "desc" },
      where: { breadthScore: { not: null } },
    });
    if (prev?.breadthScore != null) {
      const delta = breadthScore - prev.breadthScore;
      if (delta > 3) breadthTrend = "IMPROVING";
      else if (delta < -3) breadthTrend = "DECLINING";
    }
  } catch {
    // First run — no previous data
  }

  // ── Warning ──
  let warning: string | null = null;
  if (above50MA < 30) {
    warning = `BREADTH COLLAPSE — ${above50MA.toFixed(0)}% above 50d MA. Consider suspending new entries.`;
  } else if (above50MA < 40) {
    warning = `Only ${above50MA.toFixed(0)}% of universe above 50d MA — late-cycle conditions. Raise entry standards.`;
  } else if (newHighLowRatio < 30) {
    warning = `New lows dominating (${newLows} vs ${newHighs} highs) — broad market weakness.`;
  }

  const result: BreadthResult = {
    above50MA: Math.round(above50MA * 100) / 100,
    above200MA: Math.round(above200MA * 100) / 100,
    above50MA_count,
    above200MA_count,
    totalMeasured,
    newHighs,
    newLows,
    newHighLowRatio: Math.round(newHighLowRatio * 100) / 100,
    advanceDecline: Math.round(advanceDecline * 100) / 100,
    breadthScore: Math.round(breadthScore * 100) / 100,
    breadthSignal,
    breadthTrend,
    warning,
  };

  log.info(
    {
      score: result.breadthScore,
      signal: result.breadthSignal,
      trend: result.breadthTrend,
      above50MA: result.above50MA,
      totalMeasured: result.totalMeasured,
    },
    "Breadth calculated",
  );

  return result;
}

/**
 * Returns a breadth modifier for composite score adjustment.
 * Applied to the regime component of composite scoring.
 */
export function breadthModifier(signal: BreadthSignal): number {
  switch (signal) {
    case "STRONG": return 0.05;
    case "NEUTRAL": return 0.00;
    case "WEAK": return -0.05;
    case "DETERIORATING": return -0.10;
  }
}

/**
 * Returns a breadth multiplier for sector scoring.
 */
export function breadthSectorMultiplier(signal: BreadthSignal): number {
  switch (signal) {
    case "STRONG": return 1.10;
    case "NEUTRAL": return 1.00;
    case "WEAK": return 0.90;
    case "DETERIORATING": return 0.75;
  }
}
