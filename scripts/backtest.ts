// CLI: Run a backtest from cached DailyQuote data.
//
// Usage:
//   npx tsx scripts/backtest.ts --start 2023-01-01 --end 2025-12-31 --capital 10000
//   npx tsx scripts/backtest.ts --start 2023-01-01 --end 2025-12-31 --use-snapshots
//
// Flags:
//   --start <YYYY-MM-DD>     Backtest window start (inclusive). Required.
//   --end   <YYYY-MM-DD>     Backtest window end (inclusive). Required.
//   --capital <number>       Initial capital. Default 10000.
//   --risk <decimal>         Risk per trade. Default config.riskPctPerTrade.
//   --max-open <int>         Max concurrent positions. Default unlimited.
//   --commission <number>    Per-fill commission. Default 0.
//   --slippage-bps <number>  Slippage in bps. Default 5.
//   --spread-bps <number>    Half-spread in bps. Default 15.
//   --use-snapshots          Restrict universe to UniverseSnapshot at start date
//                            (eliminates survivorship bias). Falls back to live
//                            Ticker table if no snapshot exists.
//   --label <string>         Optional run label.
//   --no-save                Don't persist results to the BacktestRun table.

import "dotenv/config";
import { prisma } from "../src/db/client";
import { runBacktest } from "../src/lib/backtest";
import { DEFAULT_COST_MODEL } from "../src/lib/backtest/costModel";
import type { BacktestParams, BacktestQuoteSet } from "../src/lib/backtest/types";
import type { DailyQuote } from "../src/lib/data/fetchQuotes";

interface Args {
  start: string;
  end: string;
  capital: number;
  risk?: number;
  maxOpen?: number;
  commission: number;
  slippageBps: number;
  spreadBps: number;
  useSnapshots: boolean;
  label?: string;
  save: boolean;
}

function parseArgs(): Args {
  const out: Args = {
    start: "",
    end: "",
    capital: 10000,
    commission: DEFAULT_COST_MODEL.commissionPerTrade,
    slippageBps: DEFAULT_COST_MODEL.slippageBps,
    spreadBps: DEFAULT_COST_MODEL.spreadBps,
    useSnapshots: false,
    save: true,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--start": out.start = next!; i++; break;
      case "--end": out.end = next!; i++; break;
      case "--capital": out.capital = Number(next); i++; break;
      case "--risk": out.risk = Number(next); i++; break;
      case "--max-open": out.maxOpen = Number(next); i++; break;
      case "--commission": out.commission = Number(next); i++; break;
      case "--slippage-bps": out.slippageBps = Number(next); i++; break;
      case "--spread-bps": out.spreadBps = Number(next); i++; break;
      case "--use-snapshots": out.useSnapshots = true; break;
      case "--label": out.label = next!; i++; break;
      case "--no-save": out.save = false; break;
    }
  }
  if (!out.start || !out.end) {
    console.error("Required: --start <YYYY-MM-DD> --end <YYYY-MM-DD>");
    process.exit(1);
  }
  return out;
}

async function loadUniverse(args: Args): Promise<BacktestQuoteSet[]> {
  const db = prisma as unknown as {
    universeSnapshot: {
      findMany: (args: unknown) => Promise<Array<{ ticker: string }>>;
    };
    ticker: {
      findMany: (args: unknown) => Promise<Array<{ id: number; symbol: string }>>;
    };
    dailyQuote: {
      findMany: (args: unknown) => Promise<Array<{
        date: Date; open: number; high: number; low: number; close: number; volume: bigint;
      }>>;
    };
  };

  let symbols: string[];

  if (args.useSnapshots) {
    const snap = await db.universeSnapshot.findMany({
      where: { snapshotDate: { lte: new Date(args.start) } },
      orderBy: { snapshotDate: "desc" },
      take: 5000,
    });
    symbols = [...new Set(snap.map((s) => s.ticker))];
    if (symbols.length === 0) {
      console.warn(`[backtest] No UniverseSnapshot at/before ${args.start} — falling back to live Ticker table.`);
      const tickers = await db.ticker.findMany({ where: { active: true } });
      symbols = tickers.map((t) => t.symbol);
    } else {
      console.log(`[backtest] Using ${symbols.length} tickers from snapshot at/before ${args.start}`);
    }
  } else {
    const tickers = await db.ticker.findMany({ where: { active: true } });
    symbols = tickers.map((t) => t.symbol);
    console.log(`[backtest] Using ${symbols.length} active tickers (NOTE: subject to survivorship bias)`);
  }

  const tickers = await db.ticker.findMany({ where: { symbol: { in: symbols } } });
  const sets: BacktestQuoteSet[] = [];

  for (const t of tickers) {
    const rows = await db.dailyQuote.findMany({
      where: { tickerId: t.id, date: { gte: new Date(args.start), lte: new Date(args.end) } },
      orderBy: { date: "asc" },
    });
    if (rows.length < 25) continue;
    const quotes: DailyQuote[] = rows.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: Number(r.volume),
    }));
    sets.push({ ticker: t.symbol, quotes });
  }

  return sets;
}

async function persist(args: Args, params: BacktestParams, result: Awaited<ReturnType<typeof runBacktest>>): Promise<number> {
  const db = prisma as unknown as {
    backtestRun: {
      create: (args: unknown) => Promise<{ id: number }>;
      update: (args: unknown) => Promise<{ id: number }>;
    };
    backtestTrade: {
      createMany: (args: unknown) => Promise<unknown>;
    };
  };

  const run = await db.backtestRun.create({
    data: {
      label: args.label ?? null,
      startDate: new Date(args.start),
      endDate: new Date(args.end),
      initialCapital: params.initialCapital,
      engine: params.engine,
      riskPctPerTrade: params.riskPctPerTrade ?? null,
      commissionPerTrade: params.cost.commissionPerTrade,
      slippageBps: params.cost.slippageBps,
      spreadBps: params.cost.spreadBps,
      status: "RUNNING",
    },
  });

  const trades = result.trades.map((t) => ({
    runId: run.id,
    ticker: t.ticker,
    entryDate: new Date(t.entryDate),
    entryPrice: t.entryPrice,
    rawEntryPrice: t.rawEntryPrice,
    shares: t.shares,
    hardStop: t.hardStop,
    exitDate: t.exitDate ? new Date(t.exitDate) : null,
    exitPrice: t.exitPrice ?? null,
    rawExitPrice: t.rawExitPrice ?? null,
    exitReason: t.exitReason ?? null,
    rMultiple: t.rMultiple ?? null,
    pnl: t.pnl ?? null,
    pnlNet: t.pnlNet ?? null,
    costs: t.costs ?? null,
    barsHeld: t.barsHeld ?? null,
    signalGrade: t.signalGrade,
    signalScore: t.signalScore,
    volumeRatio: t.volumeRatio,
    atr20: t.atr20,
  }));
  if (trades.length > 0) await db.backtestTrade.createMany({ data: trades });

  await db.backtestRun.update({
    where: { id: run.id },
    data: {
      completedAt: new Date(),
      status: "COMPLETED",
      trades: result.summary.trades,
      wins: result.summary.wins,
      losses: result.summary.losses,
      winRate: result.summary.winRate,
      profitFactor: Number.isFinite(result.summary.profitFactor) ? result.summary.profitFactor : null,
      expectancyR: result.summary.expectancyR,
      totalReturnPct: result.summary.totalReturnPct,
      cagrPct: result.summary.cagrPct,
      sharpe: result.summary.sharpe,
      sortino: result.summary.sortino,
      maxDrawdownPct: result.summary.maxDrawdownPct,
      maxDrawdownDays: result.summary.maxDrawdownDays,
      finalEquity: result.summary.finalEquity,
    },
  });

  return run.id;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`[backtest] Loading universe...`);
  const universe = await loadUniverse(args);
  console.log(`[backtest] Loaded ${universe.length} tickers with sufficient history`);

  const params: BacktestParams = {
    startDate: args.start,
    endDate: args.end,
    initialCapital: args.capital,
    engine: "volume",
    cost: {
      commissionPerTrade: args.commission,
      slippageBps: args.slippageBps,
      spreadBps: args.spreadBps,
    },
    ...(args.risk !== undefined ? { riskPctPerTrade: args.risk } : {}),
    ...(args.maxOpen !== undefined ? { maxOpenPositions: args.maxOpen } : {}),
    ...(args.label !== undefined ? { label: args.label } : {}),
  };

  console.log(`[backtest] Running ${args.start} → ${args.end} on £${args.capital}...`);
  const t0 = Date.now();
  const result = runBacktest(universe, params);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const s = result.summary;
  console.log(`\n=== Backtest complete (${elapsed}s) ===`);
  console.log(`Trades:           ${s.trades} (${s.wins}W / ${s.losses}L, ${(s.winRate * 100).toFixed(1)}% win rate)`);
  console.log(`Profit factor:    ${Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : "∞"}`);
  console.log(`Expectancy (R):   ${s.expectancyR.toFixed(3)}`);
  console.log(`Total return:     ${s.totalReturnPct.toFixed(2)}%`);
  console.log(`CAGR:             ${s.cagrPct.toFixed(2)}%`);
  console.log(`Sharpe:           ${s.sharpe.toFixed(2)}`);
  console.log(`Sortino:          ${s.sortino.toFixed(2)}`);
  console.log(`Max drawdown:     ${s.maxDrawdownPct.toFixed(2)}% over ${s.maxDrawdownDays} days`);
  console.log(`Final equity:     £${s.finalEquity.toFixed(2)}`);

  if (args.save) {
    const id = await persist(args, params, result);
    console.log(`\n[backtest] Saved as BacktestRun id=${id}`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
