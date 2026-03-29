import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { config } from "@/lib/config";
import { updateTrailingStop } from "@/lib/signals/exitSignal";
import { calculateATR } from "@/lib/risk/atr";
import { getCurrencySymbol } from "@/lib/currency";
import { loadT212Settings, getCachedT212Positions, getAccountCash } from "@/lib/t212/client";
import type { T212Position } from "@/lib/t212/client";
import { calculateRMultiple, buildStopHistoryData, tradeToOpenPosition, enforceMonotonicStop } from "@/lib/trades/utils";
import type { ExitReason } from "@/lib/trades/types";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/positions/sync-all");
import { rateLimit } from "@/lib/rateLimit";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(_request: Request) {
  // Rate limit: max 3 sync-all per minute
  const limited = rateLimit(`sync-all`, 3, 60_000);
  if (limited) return limited;

  try {
    const openTrades = await prisma.trade.findMany({
      where: { status: "OPEN" },
      include: { stopHistory: { orderBy: { date: "asc" } } },
    });

    if (openTrades.length === 0) {
      return NextResponse.json({ results: [], syncedAt: new Date().toISOString(), t212: null });
    }

    // Try to fetch T212 positions if configured (uses shared cache)
    let t212Positions: T212Position[] = [];
    let t212Loaded = false;
    let t212Balance: number | null = null;
    let t212Currency: string | null = null;
    const t212Settings = loadT212Settings();
    if (t212Settings) {
      try {
        const [cached, account] = await Promise.all([
          getCachedT212Positions(t212Settings),
          getAccountCash(t212Settings),
        ]);
        t212Positions = cached.positions;
        t212Loaded = true;
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

      // Rate limit: delay between tickers
      if (i > 0) await sleep(config.syncDelayMs);

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

        const openPos = tradeToOpenPosition(trade);
        const newTrailingStop = updateTrailingStop(openPos, quotes, atr20);
        const previousStop = Math.max(trade.hardStop, trade.trailingStop);
        const newCurrentStop = Math.max(trade.hardStop, newTrailingStop);
        const stopChanged = newTrailingStop > trade.trailingStop;

        // Monotonic enforcement: only write trailing stop if it moved up
        if (stopChanged) {
          await prisma.trade.update({
            where: { id: trade.id },
            data: { trailingStop: newTrailingStop, atr20 },
          });
        } else {
          await prisma.trade.update({
            where: { id: trade.id },
            data: { atr20 },
          });
        }

        if (stopChanged) {
          await prisma.stopHistory.create({
            data: buildStopHistoryData(trade.id, now, trade.hardStop, trade.trailingStop, newTrailingStop),
          });
        }

        const exitTriggered = latestClose < newCurrentStop || latestQuote.low < newCurrentStop;

        // Also check prior days — if stop was breached on a day we didn't sync,
        // find the first breach day and use that as exit
        let breachQuote = exitTriggered ? latestQuote : null;
        if (!exitTriggered) {
          // Look back through recent quotes for any day the low breached the stop
          const lastSyncDate = trade.stopHistory.length > 0
            ? new Date(trade.stopHistory[trade.stopHistory.length - 1]!.date)
            : trade.entryDate;
          for (const q of quotes) {
            const qDate = new Date(q.date);
            if (qDate <= lastSyncDate) continue;
            if (q.low < newCurrentStop || q.close < newCurrentStop) {
              breachQuote = q;
              break; // Use the first breach day
            }
          }
        }

        const actuallyExited = breachQuote !== null;
        const c = getCurrencySymbol(trade.ticker);
        let instruction: { type: string; message: string; urgent: boolean };

        // Check if position is gone from T212 (stop hit intraday or manually sold)
        const t212Match = t212Loaded ? t212Positions.find((p) => p.ticker === trade.ticker) : undefined;
        const goneFromT212 = t212Loaded && !actuallyExited && !t212Match;

        if (actuallyExited) {
          // Auto-close the trade with the exit price
          const breachClose = breachQuote!.close;
          const exitPrice = breachClose < newCurrentStop ? breachClose : newCurrentStop;
          const rMultiple = calculateRMultiple(exitPrice, trade.entryPrice, trade.hardStop);
          const exitReason: ExitReason = exitPrice < trade.hardStop ? "HARD_STOP" : "TRAILING_STOP";
          const exitDate = new Date(breachQuote!.date);
          await prisma.trade.update({
            where: { id: trade.id },
            data: { status: "CLOSED", exitDate, exitPrice, exitReason, rMultiple },
          });
          instruction = {
            type: "EXIT",
            message: `EXITED — low ${c}${breachQuote!.low.toFixed(2)} broke stop ${c}${newCurrentStop.toFixed(2)} on ${breachQuote!.date}. Trade closed at ${c}${exitPrice.toFixed(2)}.`,
            urgent: true,
          };
        } else if (goneFromT212) {
          // Position no longer on T212 — stop hit intraday or manually sold
          const exitPrice = newCurrentStop;
          const rMultiple = calculateRMultiple(exitPrice, trade.entryPrice, trade.hardStop);
          await prisma.trade.update({
            where: { id: trade.id },
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

        const updatedTrade = await prisma.trade.findUnique({
          where: { id: trade.id },
          include: { stopHistory: { orderBy: { date: "asc" } } },
        });

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
            // Monotonic broker sync: discard T212 stop if lower than stored stop
            stopLoss: t212Match.stopLoss != null
              ? enforceMonotonicStop(t212Match.stopLoss, newCurrentStop)
              : null,
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

    // Save balance from T212 as AccountSnapshot
    if (t212Balance != null) {
      await prisma.accountSnapshot.create({
        data: {
          date: now,
          balance: t212Balance,
          openTrades: openTrades.length,
        },
      });
      log.info({ balance: t212Balance }, "Balance auto-synced from T212");
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
    log.error({ err }, "Sync all failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync all failed" },
      { status: 500 },
    );
  }
}
