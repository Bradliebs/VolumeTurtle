import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { updateTrailingStop } from "@/lib/signals/exitSignal";
import type { OpenPosition } from "@/lib/signals/exitSignal";
import { calculateATR } from "@/lib/risk/atr";
import { getCurrencySymbol } from "@/lib/currency";
import { loadT212Settings, getPositionsWithStopsMapped, getAccountCash } from "@/lib/t212/client";
import type { T212Position } from "@/lib/t212/client";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST() {
  try {
    const openTrades = await prisma.trade.findMany({
      where: { status: "OPEN" },
      include: { stopHistory: { orderBy: { date: "asc" } } },
    });

    if (openTrades.length === 0) {
      return NextResponse.json({ results: [], syncedAt: new Date().toISOString(), t212: null });
    }

    // Try to fetch T212 positions if configured
    let t212Positions: T212Position[] = [];
    let t212Balance: number | null = null;
    let t212Currency: string | null = null;
    const t212Settings = loadT212Settings();
    if (t212Settings) {
      try {
        const [positions, account] = await Promise.all([
          getPositionsWithStopsMapped(t212Settings),
          getAccountCash(t212Settings),
        ]);
        t212Positions = positions;
        t212Balance = account.total ?? account.cash ?? null;
        t212Currency = account.currencyCode ?? "GBP";
      } catch {
        // T212 fetch failed — continue with Yahoo only
      }
    }

    const results = [];
    const now = new Date();

    for (let i = 0; i < openTrades.length; i++) {
      const trade = openTrades[i]!;

      // Rate limit: 500ms delay between tickers
      if (i > 0) await sleep(500);

      try {
        const quoteMap = await fetchEODQuotes([trade.ticker]);
        const quotes = quoteMap[trade.ticker];
        if (!quotes || quotes.length === 0) {
          results.push({ tradeId: trade.id, ticker: trade.ticker, error: "No quote data" });
          continue;
        }

        const latestQuote = quotes[quotes.length - 1]!;
        const latestClose = latestQuote.close;

        const atr20 = calculateATR(quotes, 20) ?? trade.atr20;

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

        await prisma.trade.update({
          where: { id: trade.id },
          data: { trailingStop: newTrailingStop, atr20 },
        });

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

        const updatedTrade = await prisma.trade.findUnique({
          where: { id: trade.id },
          include: { stopHistory: { orderBy: { date: "asc" } } },
        });

        // Match with T212 position
        const t212Match = t212Positions.find((p) => p.ticker === trade.ticker);

        results.push({
          tradeId: trade.id,
          ticker: trade.ticker,
          trade: updatedTrade,
          latestClose,
          latestCloseDate: latestQuote.date,
          stopChanged,
          previousStop,
          instruction,
          t212: t212Match ? {
            currentPrice: t212Match.currentPrice,
            quantity: t212Match.quantity,
            averagePrice: t212Match.averagePrice,
            ppl: t212Match.ppl,
            stopLoss: t212Match.stopLoss ?? null,
            confirmed: true,
          } : null,
        });
      } catch (err) {
        results.push({
          tradeId: trade.id,
          ticker: trade.ticker,
          error: err instanceof Error ? err.message : "Sync failed",
        });
      }
    }

    return NextResponse.json({
      results,
      syncedAt: now.toISOString(),
      t212: t212Balance != null ? {
        balance: t212Balance,
        currency: t212Currency,
        positionCount: t212Positions.length,
      } : null,
    });
  } catch (err) {
    console.error("[POST /api/positions/sync-all] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync all failed" },
      { status: 500 },
    );
  }
}
