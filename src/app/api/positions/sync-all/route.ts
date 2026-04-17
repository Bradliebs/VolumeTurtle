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
import { canAutoCloseTrade } from "@/lib/trades/status";
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
    const t212Configured = t212Settings != null;
    if (t212Settings) {
      // Hard 10s timeout to prevent the route hanging on a slow/unresponsive T212.
      // On timeout, we proceed with Yahoo-only data (t212Loaded stays false, so
      // ghost-detection / auto-close logic is skipped this cycle).
      const T212_FETCH_TIMEOUT_MS = 10_000;
      try {
        const fetchPromise = Promise.all([
          getCachedT212Positions(t212Settings),
          getAccountCash(t212Settings),
        ]);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("T212_FETCH_TIMEOUT")), T212_FETCH_TIMEOUT_MS),
        );
        const [cached, account] = await Promise.race([fetchPromise, timeoutPromise]);
        t212Positions = cached.positions;
        t212Loaded = true;
        t212Balance = account.total ?? account.cash ?? null;
        t212Currency = account.currencyCode ?? "GBP";
      } catch (err) {
        const isTimeout = err instanceof Error && err.message === "T212_FETCH_TIMEOUT";
        if (isTimeout) {
          log.warn({ timeoutMs: T212_FETCH_TIMEOUT_MS }, "T212 fetch timed out \u2014 proceeding with Yahoo data only");
        }
        // T212 fetch failed or timed out \u2014 continue with Yahoo only
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
            data: { trailingStop: newTrailingStop, trailingStopPrice: newTrailingStop, atr20 },
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

        // Exit check uses the PREVIOUS stop (the one active when these bars traded),
        // NOT the newly ratcheted stop. Ratcheting the stop upward and then checking
        // against the new value causes false closes.
        const exitTriggered = latestClose < previousStop || latestQuote.low < previousStop;

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
            if (q.low < previousStop || q.close < previousStop) {
              breachQuote = q;
              break; // Use the first breach day
            }
          }
        }

        const eodBreached = breachQuote !== null;
        const c = getCurrencySymbol(trade.ticker);
        let instruction: { type: string; message: string; urgent: boolean };

        // Check if position is gone from T212 (stop hit intraday or manually sold)
        const t212Match = t212Loaded ? t212Positions.find((p) => p.ticker === trade.ticker) : undefined;
        const goneFromT212 = t212Loaded && !eodBreached && !t212Match;

        // Sync shares and entry price from T212 if they differ
        if (t212Match && (t212Match.quantity !== trade.shares || t212Match.averagePrice !== trade.entryPrice)) {
          const syncData: Record<string, unknown> = { lastSyncedAt: now };
          if (t212Match.quantity !== trade.shares) {
            log.info({ ticker: trade.ticker, dbShares: trade.shares, t212Shares: t212Match.quantity }, "Syncing shares from T212");
            syncData.shares = t212Match.quantity;
          }
          if (t212Match.averagePrice !== trade.entryPrice) {
            log.info({ ticker: trade.ticker, dbEntry: trade.entryPrice, t212Entry: t212Match.averagePrice }, "Syncing entry price from T212");
            syncData.entryPrice = t212Match.averagePrice;
          }
          await prisma.trade.update({ where: { id: trade.id }, data: syncData });
        } else if (t212Match) {
          await prisma.trade.update({ where: { id: trade.id }, data: { lastSyncedAt: now } });
        }

        // Only auto-close if T212 confirms position is gone.
        // If T212 position is still held, flag as EXIT instruction but do NOT
        // close the trade — the user needs to confirm the exit manually.
        const t212StillHeld = t212Loaded && t212Match != null;
        const actuallyExited = eodBreached && canAutoCloseTrade({
          t212Configured,
          t212Loaded,
          t212StillHeld,
        });

        if (eodBreached && t212StillHeld) {
          // EOD data shows stop breach but T212 position is still open —
          // flag for user attention, do NOT auto-close
          log.warn(
            { ticker: trade.ticker, low: breachQuote!.low, stop: previousStop },
            "EOD breach detected but T212 position still held — flagging for manual exit",
          );
          instruction = {
            type: "EXIT",
            message: `STOP BREACHED — low ${c}${breachQuote!.low.toFixed(2)} broke stop ${c}${previousStop.toFixed(2)} on ${breachQuote!.date}. T212 position still open — confirm exit manually.`,
            urgent: true,
          };
        } else if (eodBreached && t212Configured && !t212Loaded) {
          log.warn(
            { ticker: trade.ticker, low: breachQuote!.low, stop: previousStop },
            "EOD breach detected but T212 holdings unavailable — skipping auto-close",
          );
          instruction = {
            type: "EXIT",
            message: `STOP BREACHED — low ${c}${breachQuote!.low.toFixed(2)} broke stop ${c}${previousStop.toFixed(2)} on ${breachQuote!.date}. T212 holdings were unavailable, so the trade was left open pending confirmation.`,
            urgent: true,
          };
        } else if (actuallyExited) {
          // Auto-close the trade with the exit price
          const breachClose = breachQuote!.close;
          const exitPrice = breachClose < previousStop ? breachClose : previousStop;
          const rMultiple = calculateRMultiple(exitPrice, trade.entryPrice, trade.hardStop);
          const exitReason: ExitReason = exitPrice < trade.hardStop ? "HARD_STOP" : "TRAILING_STOP";
          const exitDate = new Date(breachQuote!.date);
          await prisma.trade.update({
            where: { id: trade.id },
            data: { status: "CLOSED", exitDate, exitPrice, exitReason, rMultiple },
          });
          instruction = {
            type: "EXIT",
            message: `EXITED — low ${c}${breachQuote!.low.toFixed(2)} broke stop ${c}${previousStop.toFixed(2)} on ${breachQuote!.date}. Trade closed at ${c}${exitPrice.toFixed(2)}.`,
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
      // Sanity guards: reject obvious bad data + 50% drift outliers (matches lessons.md)
      if (!Number.isFinite(t212Balance) || t212Balance <= 0) {
        log.error({ balance: t212Balance }, "Invalid T212 balance \u2014 skipping snapshot");
      } else {
        const lastSnapshot = await prisma.accountSnapshot.findFirst({
          orderBy: { date: "desc" },
        });
        const drift = lastSnapshot && lastSnapshot.balance > 0
          ? Math.abs((t212Balance - lastSnapshot.balance) / lastSnapshot.balance)
          : 0;

        if (drift > 0.5) {
          log.error(
            { balance: t212Balance, lastBalance: lastSnapshot?.balance, driftPct: (drift * 100).toFixed(1) },
            "Balance drift >50% from last snapshot \u2014 skipping write to protect equity curve",
          );
          // Best-effort alert via DB (Telegram path not imported here)
          try {
            await prisma.alert.create({
              data: {
                type: "BALANCE_DRIFT",
                ticker: "_SYSTEM_",
                severity: "critical",
                message: `T212 balance drift ${(drift * 100).toFixed(1)}% (last: ${lastSnapshot?.balance}, new: ${t212Balance}) \u2014 snapshot skipped`,
              },
            });
          } catch { /* best effort */ }
        } else {
          await prisma.accountSnapshot.create({
            data: {
              date: now,
              balance: t212Balance,
              openTrades: openTrades.length,
            },
          });
          log.info({ balance: t212Balance }, "Balance auto-synced from T212");
        }
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
    log.error({ err }, "Sync all failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync all failed" },
      { status: 500 },
    );
  }
}
