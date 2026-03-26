import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { calculateATR20 } from "@/lib/risk/atr";
import { calculateTrailingLow } from "@/lib/signals/exitSignal";
import { config } from "@/lib/config";
import { loadT212Settings, getCachedT212Positions } from "@/lib/t212/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/t212/import-all");

export async function POST(req: NextRequest) {
  try {
    const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
    if (limited) return limited;

    const t212Settings = loadT212Settings();
    if (!t212Settings) {
      return NextResponse.json({ error: "T212 not configured" }, { status: 400 });
    }

    // Fetch all T212 positions (uses shared cache)
    const cached = await getCachedT212Positions(t212Settings);
    const t212Positions = cached.positions;

    // Fetch all open VT trades
    const vtTrades = await prisma.trade.findMany({
      where: { status: "OPEN" },
    });

    // Find untracked positions
    const trackedTickers = new Set(vtTrades.map((t) => t.ticker));
    const untracked = t212Positions.filter((p) => !trackedTickers.has(p.ticker));

    if (untracked.length === 0) {
      return NextResponse.json({
        success: true,
        imported: 0,
        failed: 0,
        details: { imported: [], failed: [] },
      });
    }

    // Fetch quotes for all untracked tickers
    const untrackedTickers = untracked.map((p) => p.ticker);
    const quoteMap = await fetchEODQuotes(untrackedTickers);

    // Look for recent signals for retroactive matching
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const recentSignals = await prisma.scanResult.findMany({
      where: {
        ticker: { in: untrackedTickers },
        signalFired: true,
        scanDate: { gte: fiveDaysAgo },
      },
      orderBy: { scanDate: "desc" },
    });

    // Group signals by ticker (take most recent per ticker)
    const signalByTicker: Record<string, typeof recentSignals[0]> = {};
    for (const s of recentSignals) {
      if (!signalByTicker[s.ticker]) signalByTicker[s.ticker] = s;
    }

    // Import each untracked position
    const imported: Array<{ ticker: string; tradeId: string; hardStop: number; currentStop: number; matchedSignal: boolean }> = [];
    const failed: Array<{ ticker: string; error: string }> = [];

    for (const position of untracked) {
      try {
        const tickerQuotes = quoteMap[position.ticker];

        if (!tickerQuotes || tickerQuotes.length < 20) {
          failed.push({ ticker: position.ticker, error: "Insufficient quote data" });
          continue;
        }

        const atr20 = calculateATR20(tickerQuotes);
        if (atr20 == null) {
          failed.push({ ticker: position.ticker, error: "Could not calculate ATR" });
          continue;
        }

        // Check for duplicate (race condition safety)
        const existing = await prisma.trade.findFirst({
          where: { ticker: position.ticker, status: "OPEN" },
        });
        if (existing) {
          failed.push({ ticker: position.ticker, error: "Already has open trade" });
          continue;
        }

        const hardStop = position.averagePrice - config.hardStopAtrMultiple * atr20;
        const trailingLow = calculateTrailingLow(tickerQuotes);
        const trailingStop = trailingLow ?? hardStop;
        const currentStop = Math.max(hardStop, trailingStop);

        // Retroactive signal matching
        const matchedSignal = signalByTicker[position.ticker] ?? null;
        const volumeRatio = matchedSignal?.volumeRatio ?? 0;
        const rangePosition = matchedSignal?.rangePosition ?? 0;

        let importNote = "Imported from T212 — initial stop calculated on import";
        if (matchedSignal) {
          importNote = `Matched to signal from ${matchedSignal.scanDate.toISOString().slice(0, 10)} — volume ${volumeRatio.toFixed(1)}x, grade ${matchedSignal.compositeGrade ?? "?"}`;
        }

        const trade = await prisma.trade.create({
          data: {
            ticker: position.ticker,
            entryDate: new Date(),
            entryPrice: position.averagePrice,
            shares: position.quantity,
            hardStop,
            trailingStop: currentStop,
            status: "OPEN",
            volumeRatio,
            rangePosition,
            atr20,
            importedFromT212: true,
            importedAt: new Date(),
          },
        });

        await prisma.stopHistory.create({
          data: {
            tradeId: trade.id,
            date: new Date(),
            stopLevel: currentStop,
            stopType: hardStop > trailingStop ? "HARD" : "TRAILING",
            changed: false,
            changeAmount: null,
            note: importNote,
          },
        });

        imported.push({
          ticker: position.ticker,
          tradeId: trade.id,
          hardStop,
          currentStop,
          matchedSignal: !!matchedSignal,
        });

        log.info({ ticker: position.ticker, tradeId: trade.id }, "Batch imported from T212");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        failed.push({ ticker: position.ticker, error: msg });
        log.error({ err, ticker: position.ticker }, "Failed to import position in batch");
      }
    }

    return NextResponse.json({
      success: true,
      imported: imported.length,
      failed: failed.length,
      details: { imported, failed },
    });
  } catch (err) {
    log.error({ err }, "Failed to import all T212 positions");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to import positions" },
      { status: 500 },
    );
  }
}
