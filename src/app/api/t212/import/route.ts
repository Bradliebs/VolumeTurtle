import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/db/client";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { calculateATR20 } from "@/lib/risk/atr";
import { calculateTrailingLow } from "@/lib/signals/exitSignal";
import { config } from "@/lib/config";
import { validateBody } from "@/lib/validation";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/t212/import");

const importSchema = z.object({
  ticker: z.string().min(1, "Ticker is required"),
  quantity: z.number().positive("quantity must be positive"),
  avgPrice: z.number().positive("avgPrice must be positive"),
  currentPrice: z.number().positive("currentPrice must be positive").optional(),
});

export async function POST(req: NextRequest) {
  try {
    const limited = rateLimit(getRateLimitKey(req), 10, 60_000);
    if (limited) return limited;

    const parsed = await validateBody(req, importSchema);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { ticker, quantity, avgPrice } = parsed.data!;

    // Prevent duplicate open trades for the same ticker
    const existingOpen = await prisma.trade.findFirst({
      where: { ticker, status: "OPEN" },
    });
    if (existingOpen) {
      return NextResponse.json(
        { error: `An open trade already exists for ${ticker}` },
        { status: 409 },
      );
    }

    // Fetch historical quotes
    const quotes = await fetchEODQuotes([ticker]);
    const tickerQuotes = quotes[ticker];

    if (!tickerQuotes || tickerQuotes.length < 20) {
      return NextResponse.json(
        { error: `Insufficient data for ${ticker} (need 20+ days)` },
        { status: 400 },
      );
    }

    // Calculate ATR20
    const atr20 = calculateATR20(tickerQuotes);
    if (atr20 == null) {
      return NextResponse.json(
        { error: `Could not calculate ATR for ${ticker}` },
        { status: 400 },
      );
    }

    // Calculate stops based on actual entry price
    const hardStop = avgPrice - config.hardStopAtrMultiple * atr20;
    const trailingLow = calculateTrailingLow(tickerQuotes);
    const trailingStop = trailingLow ?? hardStop;
    const currentStop = Math.max(hardStop, trailingStop);

    // Calculate risk
    const riskPerShare = avgPrice - hardStop;
    const dollarRisk = riskPerShare * quantity;

    // Retroactive signal matching — look for a signal in the last 5 trading days
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    const recentSignal = await prisma.scanResult.findFirst({
      where: {
        ticker,
        signalFired: true,
        scanDate: { gte: fiveDaysAgo },
      },
      orderBy: { scanDate: "desc" },
    });

    const volumeRatio = recentSignal?.volumeRatio ?? 0;
    const rangePosition = recentSignal?.rangePosition ?? 0;
    const compositeScore = recentSignal?.compositeScore ?? null;
    const compositeGrade = recentSignal?.compositeGrade ?? null;

    let importNote = "Imported from T212 — initial stop calculated on import";
    if (recentSignal) {
      importNote = `Matched to signal from ${recentSignal.scanDate.toISOString().slice(0, 10)} — volume ${volumeRatio.toFixed(1)}x, grade ${compositeGrade ?? "?"}`;
    }

    // Use matched signal date as entry if available, otherwise now
    const entryDate = recentSignal ? recentSignal.scanDate : new Date();
    const signalSource = recentSignal ? "volume" : "manual";

    // Create Trade record
    const trade = await prisma.trade.create({
      data: {
        ticker,
        entryDate,
        entryPrice: avgPrice,
        shares: quantity,
        hardStop,
        hardStopPrice: hardStop,
        trailingStop: currentStop,
        trailingStopPrice: currentStop,
        status: "OPEN",
        volumeRatio,
        rangePosition,
        atr20,
        signalSource,
        signalScore: compositeScore,
        signalGrade: compositeGrade,
        importedFromT212: true,
        importedAt: new Date(),
      },
    });

    // Write initial stop history record
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

    log.info({ ticker, tradeId: trade.id, hardStop, currentStop, atr20, matched: !!recentSignal }, "Position imported from T212");

    return NextResponse.json({
      success: true,
      trade,
      matchedSignal: recentSignal
        ? {
            date: recentSignal.scanDate.toISOString(),
            grade: compositeGrade,
            volumeRatio,
            compositeScore,
          }
        : null,
      calculatedStops: {
        hardStop,
        trailingStop: currentStop,
        currentStop,
        atr20,
        riskPerShare,
        dollarRisk,
      },
    });
  } catch (err) {
    log.error({ err }, "Failed to import T212 position");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to import position" },
      { status: 500 },
    );
  }
}
