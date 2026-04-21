// Backtest-vs-live divergence tracker.
//
// Compares last 7 days of actual closed-trade P&L (Trade table) against the
// simulated P&L from the most recent BacktestRun for the same tickers and
// date range. Writes a DivergenceReport row, computes a rolling 4-week
// average, and fires a Telegram alert when |rolling 4w| > 15%.
//
// Designed to run weekly on Sunday evening after auto-tune, so the most
// recent BacktestRun reflects the strategy as currently deployed.
//
// Usage:
//   npx tsx scripts/divergenceTracker.ts
//   npm run divergence

import "dotenv/config";
import { prisma } from "../src/db/client";
import { sendTelegram } from "../src/lib/telegram";
import { convertToGbp, getGbpUsdRate, getGbpEurRate } from "../src/lib/currency";

const ALERT_THRESHOLD_PCT = 15;
const MIN_TRADES_FOR_REPORT = 3;

interface ClosedTrade {
  ticker: string;
  entryPrice: number;
  exitPrice: number;
  shares: number;
  exitDate: Date;
}

interface SimTrade {
  ticker: string;
  pnl: number | null;
  pnlNet: number | null;
  exitDate: Date | null;
}

interface PerTickerBreakdown {
  ticker: string;
  actualPnlGbp: number;
  simulatedPnlGbp: number;
  divergencePct: number | null;
  liveTrades: number;
  simTrades: number;
}

interface PriorReport {
  divergencePct: number;
  weekEnding: Date;
}

const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<Array<{
      ticker: string;
      entryPrice: number;
      exitPrice: number | null;
      shares: number;
      exitDate: Date | null;
    }>>;
  };
  backtestRun: {
    findFirst: (args: unknown) => Promise<{ id: number; startedAt: Date } | null>;
  };
  backtestTrade: {
    findMany: (args: unknown) => Promise<Array<{
      ticker: string;
      pnl: number | null;
      pnlNet: number | null;
      exitDate: Date | null;
    }>>;
  };
  divergenceReport: {
    findMany: (args: unknown) => Promise<Array<{
      divergencePct: number;
      weekEnding: Date;
    }>>;
    create: (args: unknown) => Promise<{ id: number; weekEnding: Date }>;
  };
};

/** Returns the Sunday at end of the week containing `now` (00:00 UTC). */
function endOfWeekSunday(now: Date): Date {
  const d = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const dow = d.getUTCDay(); // 0 = Sunday
  const daysUntilSunday = (7 - dow) % 7;
  d.setUTCDate(d.getUTCDate() + daysUntilSunday);
  return d;
}

function pct(actual: number, simulated: number): number | null {
  if (simulated === 0 || !Number.isFinite(simulated)) return null;
  return ((actual - simulated) / Math.abs(simulated)) * 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function main(): Promise<void> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const weekEnding = endOfWeekSunday(now);

  console.log(`[divergence] Week ending ${weekEnding.toISOString().slice(0, 10)}`);
  console.log(`[divergence] Window: ${weekAgo.toISOString()} → ${now.toISOString()}`);

  // 1) Live closed trades in the window
  const liveTradesRaw = await db.trade.findMany({
    where: {
      status: "CLOSED",
      exitDate: { gte: weekAgo, lte: now },
      exitPrice: { not: null },
    },
    orderBy: { exitDate: "asc" },
  });
  const liveTrades: ClosedTrade[] = liveTradesRaw
    .filter((t) => t.exitPrice !== null && t.exitDate !== null)
    .map((t) => ({
      ticker: t.ticker,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice as number,
      shares: t.shares,
      exitDate: t.exitDate as Date,
    }));

  console.log(`[divergence] Live closed trades: ${liveTrades.length}`);

  // 2) Most recent backtest run
  const latestRun = await db.backtestRun.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { startedAt: "desc" },
  });

  let simTrades: SimTrade[] = [];
  if (latestRun) {
    console.log(`[divergence] Using BacktestRun ${latestRun.id} (${latestRun.startedAt.toISOString().slice(0, 10)})`);
    const tickers = Array.from(new Set(liveTrades.map((t) => t.ticker)));
    if (tickers.length > 0) {
      const rows = await db.backtestTrade.findMany({
        where: {
          runId: latestRun.id,
          ticker: { in: tickers },
          exitDate: { gte: weekAgo, lte: now },
        },
      });
      simTrades = rows.map((r) => ({
        ticker: r.ticker,
        pnl: r.pnl,
        pnlNet: r.pnlNet,
        exitDate: r.exitDate,
      }));
    }
  } else {
    console.log("[divergence] No completed BacktestRun found.");
  }

  console.log(`[divergence] Simulated trades matched: ${simTrades.length}`);

  // 3) FX conversion to GBP
  const [gbpUsdRate, gbpEurRate] = await Promise.all([
    getGbpUsdRate().catch(() => 1.27),
    getGbpEurRate().catch(() => 1.17),
  ]);

  // 4) Per-ticker aggregation
  const byTicker = new Map<string, PerTickerBreakdown>();
  const ensure = (ticker: string): PerTickerBreakdown => {
    let row = byTicker.get(ticker);
    if (!row) {
      row = {
        ticker,
        actualPnlGbp: 0,
        simulatedPnlGbp: 0,
        divergencePct: null,
        liveTrades: 0,
        simTrades: 0,
      };
      byTicker.set(ticker, row);
    }
    return row;
  };

  for (const t of liveTrades) {
    const pnlNative = (t.exitPrice - t.entryPrice) * t.shares;
    const row = ensure(t.ticker);
    row.actualPnlGbp += convertToGbp(pnlNative, t.ticker, gbpUsdRate, gbpEurRate);
    row.liveTrades += 1;
  }

  for (const s of simTrades) {
    const pnlNative = s.pnlNet ?? s.pnl ?? 0;
    const row = ensure(s.ticker);
    row.simulatedPnlGbp += convertToGbp(pnlNative, s.ticker, gbpUsdRate, gbpEurRate);
    row.simTrades += 1;
  }

  for (const row of byTicker.values()) {
    row.actualPnlGbp = round2(row.actualPnlGbp);
    row.simulatedPnlGbp = round2(row.simulatedPnlGbp);
    row.divergencePct = pct(row.actualPnlGbp, row.simulatedPnlGbp);
    if (row.divergencePct !== null) row.divergencePct = round2(row.divergencePct);
  }

  // 5) Aggregate totals
  const actualPnlGbp = round2(
    Array.from(byTicker.values()).reduce((s, r) => s + r.actualPnlGbp, 0),
  );
  const simulatedPnlGbp = round2(
    Array.from(byTicker.values()).reduce((s, r) => s + r.simulatedPnlGbp, 0),
  );
  const totalSignals = simTrades.length;
  const executedSignals = liveTrades.length;
  const overallDivergencePct = pct(actualPnlGbp, simulatedPnlGbp);

  // 6) Insufficient data → write a no-alert report and exit cleanly
  const insufficientData =
    liveTrades.length < MIN_TRADES_FOR_REPORT ||
    overallDivergencePct === null;

  if (insufficientData) {
    const note =
      liveTrades.length < MIN_TRADES_FOR_REPORT
        ? `Insufficient data: only ${liveTrades.length} live trades closed this week (need ≥ ${MIN_TRADES_FOR_REPORT}).`
        : "Insufficient data: simulated P&L is zero — divergence undefined.";
    console.log(`[divergence] ${note}`);

    await db.divergenceReport.create({
      data: {
        weekEnding,
        totalSignals,
        executedSignals,
        simulatedPnlGbp,
        actualPnlGbp,
        divergencePct: 0,
        rollingDivergence4w: 0,
        alertTriggered: false,
        details: {
          note,
          tickers: Array.from(byTicker.values()),
          backtestRunId: latestRun?.id ?? null,
        },
      },
    });
    console.log("[divergence] Report written (no alert).");
    return;
  }

  // 7) Rolling 4-week divergence — average of last 4 prior reports
  const priorReports: PriorReport[] = await db.divergenceReport.findMany({
    orderBy: { weekEnding: "desc" },
    take: 4,
  });
  const window = [overallDivergencePct, ...priorReports.map((r) => r.divergencePct)].slice(0, 4);
  const rollingDivergence4w = round2(
    window.reduce((s, n) => s + n, 0) / window.length,
  );

  const alertTriggered = Math.abs(rollingDivergence4w) > ALERT_THRESHOLD_PCT;

  // 8) Persist report
  const report = await db.divergenceReport.create({
    data: {
      weekEnding,
      totalSignals,
      executedSignals,
      simulatedPnlGbp,
      actualPnlGbp,
      divergencePct: round2(overallDivergencePct),
      rollingDivergence4w,
      alertTriggered,
      details: {
        backtestRunId: latestRun?.id ?? null,
        windowStart: weekAgo.toISOString(),
        windowEnd: now.toISOString(),
        gbpUsdRate,
        gbpEurRate,
        tickers: Array.from(byTicker.values()),
        priorWindow: window,
      },
    },
  });

  console.log(`[divergence] Report ${report.id} written.`);
  console.log(`[divergence] Actual: £${actualPnlGbp.toFixed(2)}  Simulated: £${simulatedPnlGbp.toFixed(2)}`);
  console.log(`[divergence] Divergence: ${round2(overallDivergencePct).toFixed(2)}%  Rolling 4w: ${rollingDivergence4w.toFixed(2)}%`);

  // 9) Alert
  if (alertTriggered) {
    const sign = rollingDivergence4w > 0 ? "+" : "";
    const message =
      `⚠️ DIVERGENCE ALERT: Live performance diverging from backtest by ${sign}${rollingDivergence4w.toFixed(1)}% over 4 weeks. Review execution quality.\n` +
      `\n` +
      `Week ending: ${weekEnding.toISOString().slice(0, 10)}\n` +
      `This week: actual £${actualPnlGbp.toFixed(2)} vs sim £${simulatedPnlGbp.toFixed(2)} (${round2(overallDivergencePct).toFixed(1)}%)\n` +
      `Live trades: ${executedSignals}  Sim trades: ${totalSignals}`;
    try {
      await sendTelegram({ text: message });
      console.log("[divergence] Telegram alert sent.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown";
      console.error(`[divergence] Telegram alert failed: ${msg}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[divergence] Fatal error:", err);
    process.exit(1);
  });
