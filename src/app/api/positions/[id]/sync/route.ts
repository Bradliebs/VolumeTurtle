import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { updateTrailingStop } from "@/lib/signals/exitSignal";
import { calculateATR } from "@/lib/risk/atr";
import { getCurrencySymbol } from "@/lib/currency";
import { loadT212Settings, getCachedT212Positions } from "@/lib/t212/client";
import { calculateRMultiple, buildStopHistoryData, tradeToOpenPosition, enforceMonotonicStop } from "@/lib/trades/utils";
import type { ExitReason } from "@/lib/trades/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/positions/:id/sync");

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

    // Recalculate trailing stop (R-ladder + ATR trailing, monotonic)
    const openPos = tradeToOpenPosition(trade);
    const newTrailingStop = updateTrailingStop(openPos, quotes, atr20);
    const previousStop = Math.max(trade.hardStop, trade.trailingStop);
    const newCurrentStop = Math.max(trade.hardStop, newTrailingStop);
    const stopChanged = newTrailingStop > trade.trailingStop;

    // Monotonic enforcement: only write if stop moved up
    if (stopChanged) {
      await prisma.trade.update({
        where: { id },
        data: {
          trailingStop: newTrailingStop,
          atr20,
        },
      });
    } else {
      // ATR can still update even if stop didn't change
      await prisma.trade.update({
        where: { id },
        data: { atr20 },
      });
    }

    // Write StopHistory if stop changed
    if (stopChanged) {
      await prisma.stopHistory.create({
        data: buildStopHistoryData(trade.id, now, trade.hardStop, trade.trailingStop, newTrailingStop),
      });
    }

    // Determine instruction
    let exitTriggered = latestClose < newCurrentStop || latestQuote.low < newCurrentStop;

    // Also check prior days — if stop was breached on a day we didn't sync
    const tradeWithHistory = await prisma.trade.findUnique({
      where: { id },
      include: { stopHistory: { orderBy: { date: "desc" }, take: 1 } },
    });
    let breachQuote = exitTriggered ? latestQuote : null;
    if (!exitTriggered) {
      const lastSyncDate = tradeWithHistory?.stopHistory[0]
        ? new Date(tradeWithHistory.stopHistory[0].date)
        : trade.entryDate;
      for (const q of quotes) {
        const qDate = new Date(q.date);
        if (qDate <= lastSyncDate) continue;
        if (q.low < newCurrentStop || q.close < newCurrentStop) {
          breachQuote = q;
          exitTriggered = true;
          break;
        }
      }
    }

    const c = getCurrencySymbol(trade.ticker);
    let instruction: { type: string; message: string; urgent: boolean };

    // Try to match with T212 position
    let t212Data = null;
    let t212Loaded = false;
    const t212Settings = loadT212Settings();
    if (t212Settings) {
      try {
        const cached = await getCachedT212Positions(t212Settings);
        const t212Match = cached.positions.find((p) => p.ticker === trade.ticker);
        t212Loaded = true;
        if (t212Match) {
          const brokerStop = t212Match.stopLoss ?? null;

          // If T212 stop is HIGHER than our system stop, pull system up to match
          if (brokerStop !== null && brokerStop > newCurrentStop) {
            log.info(
              { ticker: trade.ticker, systemStop: newCurrentStop, t212Stop: brokerStop },
              "T212 stop is ahead of system — pulling system stop up",
            );
            await prisma.trade.update({
              where: { id },
              data: { trailingStop: brokerStop },
            });
            // Also write stop history for the pull-up
            await prisma.stopHistory.create({
              data: buildStopHistoryData(trade.id, now, trade.hardStop, newTrailingStop, brokerStop),
            });
            // Auto-mark as actioned since T212 already has this stop
            const latestHistory = await prisma.stopHistory.findFirst({
              where: { tradeId: id, changed: true, actioned: false },
              orderBy: { date: "desc" },
            });
            if (latestHistory) {
              await prisma.stopHistory.update({
                where: { id: latestHistory.id },
                data: { actioned: true, actionedAt: now },
              });
            }
          }

          const effectiveBrokerStop = brokerStop !== null
            ? enforceMonotonicStop(brokerStop, newCurrentStop)
            : null;
          t212Data = {
            currentPrice: t212Match.currentPrice,
            quantity: t212Match.quantity,
            averagePrice: t212Match.averagePrice,
            ppl: t212Match.ppl,
            stopLoss: effectiveBrokerStop,
            confirmed: true,
          };
        }
      } catch {
        // T212 fetch failed — continue without
      }
    }

    const goneFromT212 = t212Loaded && !exitTriggered && !t212Data;

    if (exitTriggered) {
      // Auto-close the trade with the exit price
      const bq = breachQuote ?? latestQuote;
      const exitPrice = bq.close < newCurrentStop ? bq.close : newCurrentStop;
      const rMultiple = calculateRMultiple(exitPrice, trade.entryPrice, trade.hardStop);
      const exitReason: ExitReason = exitPrice < trade.hardStop ? "HARD_STOP" : "TRAILING_STOP";
      const exitDate = new Date(bq.date);
      await prisma.trade.update({
        where: { id },
        data: { status: "CLOSED", exitDate, exitPrice, exitReason, rMultiple },
      });
      instruction = {
        type: "EXIT",
        message: `EXITED — low ${c}${bq.low.toFixed(2)} broke stop ${c}${newCurrentStop.toFixed(2)} on ${bq.date}. Trade closed at ${c}${exitPrice.toFixed(2)}.`,
        urgent: true,
      };
    } else if (goneFromT212) {
      // Position no longer on T212 — stop hit intraday or manually sold
      const exitPrice = newCurrentStop;
      const rMultiple = calculateRMultiple(exitPrice, trade.entryPrice, trade.hardStop);
      await prisma.trade.update({
        where: { id },
        data: { status: "CLOSED", exitDate: now, exitPrice, exitReason: "T212_STOP", rMultiple },
      });
      instruction = {
        type: "EXIT",
        message: `EXITED — position no longer held on T212. Closed at stop ${c}${exitPrice.toFixed(2)}.`,
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
    log.error({ err }, "Single position sync failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
