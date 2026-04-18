// Backtest runner — shared logic used by both the CLI script and the API.
//
// Loads quote universe, runs the engine, and persists results. Returns the
// BacktestRun id so the caller (UI or terminal) can link to the saved run.

import { prisma } from "@/db/client";
import { runBacktest } from "./engine";
import { DEFAULT_COST_MODEL } from "./costModel";
import type { BacktestParams, BacktestQuoteSet, BacktestResult } from "./types";
import type { DailyQuote } from "@/lib/data/fetchQuotes";

export interface RunnerOptions {
  start: string;             // YYYY-MM-DD
  end: string;               // YYYY-MM-DD
  capital: number;
  riskPctPerTrade?: number;
  maxOpenPositions?: number;
  commissionPerTrade?: number;
  slippageBps?: number;
  spreadBps?: number;
  useSnapshots?: boolean;
  label?: string;
  persist?: boolean;         // default true
  // Tier-2 risk controls
  convictionMultipliers?: { A?: number; B?: number; C?: number; D?: number };
  portfolioHeatCapPct?: number;
  maxPositionsPerSector?: number;
}

export interface RunnerResult {
  runId: number | null;      // null if persist=false
  result: BacktestResult;
  universeSize: number;
}

interface DbShim {
  universeSnapshot: {
    findMany: (args: unknown) => Promise<Array<{ ticker: string }>>;
  };
  ticker: {
    findMany: (args: unknown) => Promise<Array<{ id: number; symbol: string; sector: string | null }>>;
  };
  dailyQuote: {
    findMany: (args: unknown) => Promise<Array<{
      date: Date; open: number; high: number; low: number; close: number; volume: bigint;
    }>>;
  };
  backtestRun: {
    create: (args: unknown) => Promise<{ id: number }>;
    update: (args: unknown) => Promise<{ id: number }>;
  };
  backtestTrade: {
    createMany: (args: unknown) => Promise<unknown>;
  };
}

const db = prisma as unknown as DbShim;

async function loadUniverse(opts: RunnerOptions): Promise<BacktestQuoteSet[]> {
  let symbols: string[];

  if (opts.useSnapshots) {
    const snap = await db.universeSnapshot.findMany({
      where: { snapshotDate: { lte: new Date(opts.start) } },
      orderBy: { snapshotDate: "desc" },
      take: 5000,
    });
    symbols = [...new Set(snap.map((s) => s.ticker))];
    if (symbols.length === 0) {
      const tickers = await db.ticker.findMany({ where: { active: true } });
      symbols = tickers.map((t) => t.symbol);
    }
  } else {
    const tickers = await db.ticker.findMany({ where: { active: true } });
    symbols = tickers.map((t) => t.symbol);
  }

  const tickers = await db.ticker.findMany({ where: { symbol: { in: symbols } } });
  const sets: BacktestQuoteSet[] = [];

  for (const t of tickers) {
    const rows = await db.dailyQuote.findMany({
      where: { tickerId: t.id, date: { gte: new Date(opts.start), lte: new Date(opts.end) } },
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
    sets.push({ ticker: t.symbol, sector: t.sector, quotes });
  }
  return sets;
}

/**
 * Run a backtest end-to-end: load universe, execute engine, persist results.
 * Safe to call from API routes — does its own DB persistence.
 */
export async function runBacktestEndToEnd(opts: RunnerOptions): Promise<RunnerResult> {
  const persist = opts.persist !== false;

  const params: BacktestParams = {
    startDate: opts.start,
    endDate: opts.end,
    initialCapital: opts.capital,
    engine: "volume",
    cost: {
      commissionPerTrade: opts.commissionPerTrade ?? DEFAULT_COST_MODEL.commissionPerTrade,
      slippageBps: opts.slippageBps ?? DEFAULT_COST_MODEL.slippageBps,
      spreadBps: opts.spreadBps ?? DEFAULT_COST_MODEL.spreadBps,
    },
    ...(opts.riskPctPerTrade !== undefined ? { riskPctPerTrade: opts.riskPctPerTrade } : {}),
    ...(opts.maxOpenPositions !== undefined ? { maxOpenPositions: opts.maxOpenPositions } : {}),
    ...(opts.convictionMultipliers !== undefined ? { convictionMultipliers: opts.convictionMultipliers } : {}),
    ...(opts.portfolioHeatCapPct !== undefined ? { portfolioHeatCapPct: opts.portfolioHeatCapPct } : {}),
    ...(opts.maxPositionsPerSector !== undefined ? { maxPositionsPerSector: opts.maxPositionsPerSector } : {}),
    ...(opts.label !== undefined ? { label: opts.label } : {}),
  };

  let runId: number | null = null;
  if (persist) {
    const created = await db.backtestRun.create({
      data: {
        label: opts.label ?? null,
        startDate: new Date(opts.start),
        endDate: new Date(opts.end),
        initialCapital: params.initialCapital,
        engine: params.engine,
        riskPctPerTrade: params.riskPctPerTrade ?? null,
        commissionPerTrade: params.cost.commissionPerTrade,
        slippageBps: params.cost.slippageBps,
        spreadBps: params.cost.spreadBps,
        convictionMultA: params.convictionMultipliers?.A ?? null,
        convictionMultB: params.convictionMultipliers?.B ?? null,
        convictionMultC: params.convictionMultipliers?.C ?? null,
        convictionMultD: params.convictionMultipliers?.D ?? null,
        portfolioHeatCapPct: params.portfolioHeatCapPct ?? null,
        maxPositionsPerSector: params.maxPositionsPerSector ?? null,
        status: "RUNNING",
      },
    });
    runId = created.id;
  }

  try {
    const universe = await loadUniverse(opts);
    const result = runBacktest(universe, params);

    if (persist && runId !== null) {
      const tradesData = result.trades.map((t) => ({
        runId: runId!,
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
      if (tradesData.length > 0) await db.backtestTrade.createMany({ data: tradesData });

      await db.backtestRun.update({
        where: { id: runId },
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
          blockedByHeatCap: result.summary.blockedByHeatCap ?? null,
          blockedBySectorCap: result.summary.blockedBySectorCap ?? null,
          actualStartDate: result.summary.actualStartDate ? new Date(result.summary.actualStartDate) : null,
          actualEndDate: result.summary.actualEndDate ? new Date(result.summary.actualEndDate) : null,
          actualYears: result.summary.actualYears,
        },
      });
    }

    return { runId, result, universeSize: universe.length };
  } catch (err) {
    if (persist && runId !== null) {
      await db.backtestRun.update({
        where: { id: runId },
        data: {
          completedAt: new Date(),
          status: "FAILED",
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
    throw err;
  }
}

/**
 * Snapshot the current active ticker universe to UniverseSnapshot.
 * Idempotent for a given date — replaces any existing rows.
 */
export async function snapshotUniverse(date: Date = new Date()): Promise<number> {
  const snapshotDate = new Date(date.toISOString().slice(0, 10));

  const dbSnap = prisma as unknown as {
    ticker: {
      findMany: (args: unknown) => Promise<Array<{
        symbol: string; sector: string | null;
      }>>;
    };
    universeSnapshot: {
      deleteMany: (args: unknown) => Promise<{ count: number }>;
      createMany: (args: unknown) => Promise<{ count: number }>;
    };
  };

  const tickers = await dbSnap.ticker.findMany({ where: { active: true } });
  if (tickers.length === 0) return 0;

  await dbSnap.universeSnapshot.deleteMany({ where: { snapshotDate } });
  await dbSnap.universeSnapshot.createMany({
    data: tickers.map((t) => ({
      snapshotDate,
      ticker: t.symbol,
      sector: t.sector,
      source: "auto",
    })),
  });
  return tickers.length;
}
