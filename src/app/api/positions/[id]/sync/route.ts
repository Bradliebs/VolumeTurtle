import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { updateTrailingStop } from "@/lib/signals/exitSignal";
import type { OpenPosition } from "@/lib/signals/exitSignal";
import { calculateATR } from "@/lib/risk/atr";
import { getCurrencySymbol } from "@/lib/currency";
import { loadT212Settings, getPositionsWithStopsMapped } from "@/lib/t212/client";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const trade = await prisma.trade.findUnique({ where: { id } });
    if (!trade) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }
    if (trade.status !== "OPEN") {
      return NextResponse.json({ error: "Trade is not open" }, { status: 400 });
    }

    // Fetch latest quotes
    const quoteMap = await fetchEODQuotes([trade.ticker]);
    const quotes = quoteMap[trade.ticker];
    if (!quotes || quotes.length === 0) {
      return NextResponse.json({ error: "No quote data available" }, { status: 502 });
    }

    const latestQuote = quotes[quotes.length - 1]!;
    const latestClose = latestQuote.close;
    const now = new Date();

    // Recalculate ATR20
    const atr20 = calculateATR(quotes, 20) ?? trade.atr20;

    // Recalculate trailing stop (ratchet only)
    const openPos: OpenPosition = {
      ticker: trade.ticker,
      entryDate: trade.entryDate.toISOString().slice(0, 10),
      entryPrice: trade.entryPrice,
      shares: trade.shares,
      hardStop: trade.hardStop,
      trailingStop: trade.trailingStop,
      currentStop: Math.max(trade.hardStop, trade.trailingStop),
    };
    const newTrailingStop = updateTrailingStop(openPos, quotes);
    const previousStop = Math.max(trade.hardStop, trade.trailingStop);
    const newCurrentStop = Math.max(trade.hardStop, newTrailingStop);
    const stopChanged = newTrailingStop > trade.trailingStop;

    // Update trade in database
    await prisma.trade.update({
      where: { id },
      data: {
        trailingStop: newTrailingStop,
        atr20,
      },
    });

    // Write StopHistory if stop changed
    if (stopChanged) {
      await prisma.stopHistory.create({
        data: {
          tradeId: trade.id,
          date: now,
          stopLevel: newCurrentStop,
          stopType: newCurrentStop > trade.hardStop ? "TRAILING" : "HARD",
          changed: true,
          changeAmount: newCurrentStop - previousStop,
        },
      });
    }

    // Determine instruction
    const exitTriggered = latestClose < newCurrentStop;
    const c = getCurrencySymbol(trade.ticker);
    let instruction: { type: string; message: string; urgent: boolean };

    if (exitTriggered) {
      instruction = {
        type: "EXIT",
        message: `EXIT — close ${c}${latestClose.toFixed(2)} broke stop ${c}${newCurrentStop.toFixed(2)}. Sell at market open on Trading 212.`,
        urgent: true,
      };
    } else if (stopChanged) {
      instruction = {
        type: "UPDATE_STOP",
        message: `Move stop to ${c}${newTrailingStop.toFixed(2)} (was ${c}${previousStop.toFixed(2)}) on Trading 212.`,
        urgent: false,
      };
    } else {
      instruction = {
        type: "HOLD",
        message: "No action needed — stop unchanged, price above stop.",
        urgent: false,
      };
    }

    // Fetch updated trade
    const updatedTrade = await prisma.trade.findUnique({
      where: { id },
      include: { stopHistory: { orderBy: { date: "asc" } } },
    });

    // Try to match with T212 position
    let t212Data = null;
    const t212Settings = loadT212Settings();
    if (t212Settings) {
      try {
        const t212Positions = await getPositionsWithStopsMapped(t212Settings);
        const t212Match = t212Positions.find((p) => p.ticker === trade.ticker);
        if (t212Match) {
          t212Data = {
            currentPrice: t212Match.currentPrice,
            quantity: t212Match.quantity,
            averagePrice: t212Match.averagePrice,
            ppl: t212Match.ppl,
            stopLoss: t212Match.stopLoss ?? null,
            confirmed: true,
          };
        }
      } catch {
        // T212 fetch failed — continue without
      }
    }

    return NextResponse.json({
      trade: updatedTrade,
      tradeId: id,
      ticker: trade.ticker,
      latestClose,
      latestCloseDate: latestQuote.date,
      syncedAt: now.toISOString(),
      stopChanged,
      previousStop,
      instruction,
      t212: t212Data,
    });
  } catch (err) {
    console.error("[POST /api/positions/:id/sync] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
