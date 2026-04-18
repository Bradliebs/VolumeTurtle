import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

interface BacktestRunRow {
  id: number;
  startedAt: Date;
  completedAt: Date | null;
  label: string | null;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  engine: string;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  totalReturnPct: number | null;
  cagrPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownPct: number | null;
  finalEquity: number | null;
  blockedByHeatCap: number | null;
  blockedBySectorCap: number | null;
  portfolioHeatCapPct: number | null;
  maxPositionsPerSector: number | null;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
  actualYears: number | null;
  status: string;
  error: string | null;
}

const db = prisma as unknown as {
  backtestRun: {
    findMany: (args: unknown) => Promise<BacktestRunRow[]>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const runs = await db.backtestRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      label: r.label,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      startDate: r.startDate.toISOString().slice(0, 10),
      endDate: r.endDate.toISOString().slice(0, 10),
      initialCapital: r.initialCapital,
      engine: r.engine,
      trades: r.trades,
      winRate: r.winRate,
      profitFactor: r.profitFactor,
      expectancyR: r.expectancyR,
      totalReturnPct: r.totalReturnPct,
      cagrPct: r.cagrPct,
      sharpe: r.sharpe,
      sortino: r.sortino,
      maxDrawdownPct: r.maxDrawdownPct,
      finalEquity: r.finalEquity,
      blockedByHeatCap: r.blockedByHeatCap,
      blockedBySectorCap: r.blockedBySectorCap,
      portfolioHeatCapPct: r.portfolioHeatCapPct,
      maxPositionsPerSector: r.maxPositionsPerSector,
      actualStartDate: r.actualStartDate?.toISOString().slice(0, 10) ?? null,
      actualEndDate: r.actualEndDate?.toISOString().slice(0, 10) ?? null,
      actualYears: r.actualYears,
      status: r.status,
      error: r.error,
    })),
  });
}
