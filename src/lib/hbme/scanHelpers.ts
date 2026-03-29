import { prisma } from "@/db/client";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { config } from "@/lib/config";
import { evaluateTrailingStop } from "@/lib/risk/trailingStop";
import type { SectorScore, BreakoutCandidate, NearMiss } from "@/lib/hbme/types";

// ---------------------------------------------------------------------------
// Prisma delegate shims (new models not yet on typed PrismaClient)
// ---------------------------------------------------------------------------

const db = prisma as unknown as {
  sectorScanResult: {
    createMany: (args: { data: unknown[] }) => Promise<{ count: number }>;
  };
  momentumSignal: {
    upsert: (args: unknown) => Promise<unknown>;
  };
  trade: {
    findMany: (args: unknown) => Promise<Array<{
      id: string;
      ticker: string;
      entryPrice: number;
      hardStop: number;
      hardStopPrice: number | null;
      trailingStopPrice: number | null;
      peakClosePrice: number | null;
      stopSource: string | null;
    }>>;
    update: (args: unknown) => Promise<unknown>;
  };
};

// ---------------------------------------------------------------------------
// saveSectorResults
// ---------------------------------------------------------------------------

export async function saveSectorResults(
  sectors: SectorScore[],
  scanRunId: number,
): Promise<void> {
  if (sectors.length === 0) return;

  const data = sectors.map((s, i) => ({
    runAt: new Date(),
    sector: s.sector,
    score: s.score,
    R5: s.R5,
    R20: s.R20,
    volRatio: s.volRatio,
    R5Rank: i + 1,
    R20Rank: i + 1,
    volRank: i + 1,
    tickerCount: 0,
    hotCount: 0,
    ma5AboveMa20: false,
    scanRunId,
  }));

  await db.sectorScanResult.createMany({ data });
}

// ---------------------------------------------------------------------------
// saveMomentumSignals
// ---------------------------------------------------------------------------

export async function saveMomentumSignals(
  candidates: BreakoutCandidate[],
  nearMisses: NearMiss[],
  scanRunId: number,
): Promise<void> {
  const upsertRow = async (row: Record<string, unknown>) => {
    await db.momentumSignal.upsert({
      where: { ticker_scanRunId: { ticker: row.ticker as string, scanRunId } },
      create: row,
      update: row,
    });
  };

  for (const c of candidates) {
    await upsertRow({
      createdAt: new Date(),
      ticker: c.ticker,
      sector: c.sector,
      chg1d: c.chg1d,
      volRatio: c.volRatio,
      R5: c.R5,
      R20: c.R20,
      price: c.price,
      sma20: 0,
      atr: 0,
      stopPrice: 0,
      compositeScore: c.compositeScore.total,
      grade: c.compositeScore.grade,
      regimeScore: c.regimeScore ?? 0,
      tickerTrend: c.tickerTrend ?? "INSUFFICIENT_DATA",
      sectorScore: c.compositeScore.components.sector,
      sectorRank: 0,
      status: "active",
      scanRunId,
    });
  }

  for (const nm of nearMisses) {
    await upsertRow({
      createdAt: new Date(),
      ticker: nm.ticker,
      sector: nm.sector,
      chg1d: nm.chg1d,
      volRatio: nm.volRatio,
      R5: nm.R5,
      R20: nm.R20,
      price: nm.price,
      sma20: 0,
      atr: 0,
      stopPrice: 0,
      compositeScore: nm.projectedScore.total,
      grade: nm.projectedGrade,
      regimeScore: 0,
      tickerTrend: "INSUFFICIENT_DATA",
      sectorScore: 0,
      sectorRank: 0,
      status: "near-miss",
      scanRunId,
    });
  }
}

// ---------------------------------------------------------------------------
// updateMomentumTrailingStops
// ---------------------------------------------------------------------------

export async function updateMomentumTrailingStops(): Promise<void> {
  const openMomentumTrades = await db.trade.findMany({
    where: { status: "OPEN", signalSource: "momentum" },
  });

  if (openMomentumTrades.length === 0) return;

  const tickers = openMomentumTrades.map((t) => t.ticker);
  const quoteMap = await fetchEODQuotes(tickers);

  for (const trade of openMomentumTrades) {
    const quotes = quoteMap[trade.ticker];
    if (!quotes || quotes.length === 0) continue;

    const hardStop = trade.hardStopPrice ?? trade.hardStop;
    const result = evaluateTrailingStop(
      quotes,
      trade.entryPrice,
      hardStop,
      config.trailingStopDays,
      trade.peakClosePrice,
    );

    await db.trade.update({
      where: { id: trade.id },
      data: {
        trailingStopPrice: result.trailingStopPrice,
        peakClosePrice: result.peakClosePrice,
        stopSource: result.stopSource,
      },
    });
  }
}
