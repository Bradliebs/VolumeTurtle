import { prisma } from "@/db/client";
import { getCachedQuotes } from "@/lib/data/quoteCache";
import { evaluateTrailingStop } from "@/lib/risk/trailingStop";
import { loadT212Settings, updateStopOnT212, getCachedT212Positions } from "@/lib/t212/client";
import { config } from "@/lib/config";
import { createLogger } from "@/lib/logger";

const log = createLogger("ratchetStops");

export interface RatchetPositionResult {
  ticker: string;
  oldStop: number;
  newStop: number;
  activeStop: number;
  ratcheted: boolean;
  pushed: boolean;
  error: string | null;
}

export interface RatchetResult {
  processed: number;
  ratcheted: number;
  skipped: number;
  pushed: number;
  results: RatchetPositionResult[];
}

const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<Array<{
      id: string;
      ticker: string;
      entryPrice: number;
      shares: number;
      hardStop: number;
      trailingStop: number;
      hardStopPrice: number | null;
      trailingStopPrice: number | null;
      peakClosePrice: number | null;
      stopSource: string | null;
    }>>;
    update: (args: unknown) => Promise<unknown>;
  };
  alert: {
    create: (args: unknown) => Promise<unknown>;
  };
};

export async function ratchetAllStops(pushToT212 = false): Promise<RatchetResult> {
  const openTrades = await db.trade.findMany({
    where: { status: "OPEN" },
  });

  const result: RatchetResult = {
    processed: 0,
    ratcheted: 0,
    skipped: 0,
    pushed: 0,
    results: [],
  };

  if (openTrades.length === 0) return result;

  const since = new Date();
  since.setDate(since.getDate() - config.quoteLookbackDays);

  const t212Settings = pushToT212 ? loadT212Settings() : null;

  // Load T212 stop prices for floor enforcement
  const t212StopMap = new Map<string, number>();
  if (t212Settings) {
    try {
      const cached = await getCachedT212Positions(t212Settings);
      for (const pos of cached.positions) {
        if (pos.stopLoss != null && pos.stopLoss > 0) {
          t212StopMap.set(pos.ticker, pos.stopLoss);
        }
      }
    } catch (err) {
      log.warn({ err }, "Could not load T212 positions for floor check — continuing without");
    }
  }

  for (const trade of openTrades) {
    result.processed++;

    // Load cached candles
    const candles = await getCachedQuotes(trade.ticker, since);
    if (candles.length < 5) {
      log.info({ ticker: trade.ticker, candles: candles.length }, "Skipping — insufficient cached data");
      result.skipped++;
      result.results.push({
        ticker: trade.ticker,
        oldStop: trade.trailingStopPrice ?? trade.trailingStop,
        newStop: trade.trailingStopPrice ?? trade.trailingStop,
        activeStop: Math.max(trade.hardStopPrice ?? trade.hardStop, trade.trailingStopPrice ?? trade.trailingStop),
        ratcheted: false,
        pushed: false,
        error: `Only ${candles.length} candles cached`,
      });
      continue;
    }

    const hardStop = trade.hardStopPrice ?? trade.hardStop;
    const currentTrailing = trade.trailingStopPrice ?? trade.trailingStop;

    const evalResult = evaluateTrailingStop(
      candles,
      trade.entryPrice,
      hardStop,
      config.trailingStopDays,
      trade.peakClosePrice,
    );

    const ratcheted = evalResult.trailingStopPrice > currentTrailing;
    const newTrailing = ratcheted ? evalResult.trailingStopPrice : currentTrailing;
    let activeStop = Math.max(hardStop, newTrailing);

    // T212 floor enforcement: never let activeStop drop below T212's current stop
    const t212Stop = t212StopMap.get(trade.ticker);
    let stopSource = evalResult.stopSource;
    if (t212Stop != null && t212Stop > activeStop) {
      log.info({ ticker: trade.ticker, computed: activeStop, t212Stop }, "T212 stop is higher than computed — using T212 as floor");
      activeStop = t212Stop;
      stopSource = "t212_floor" as "atr" | "trailing";
    }

    if (ratcheted) {
      await db.trade.update({
        where: { id: trade.id },
        data: {
          trailingStop: newTrailing,
          trailingStopPrice: newTrailing,
          peakClosePrice: evalResult.peakClosePrice,
          stopSource,
        },
      });
      result.ratcheted++;

      // Create alert
      await db.alert.create({
        data: {
          type: "STATUS_CHANGE",
          ticker: trade.ticker,
          message: `Stop ratcheted $${currentTrailing.toFixed(2)} -> $${newTrailing.toFixed(2)} (trail ${config.trailingStopDays}d low)`,
          severity: "info",
          price: newTrailing,
          stopPrice: activeStop,
          signalSource: null,
        },
      });
    }

    // Push to T212 only if the new activeStop is HIGHER than T212's current stop
    let pushed = false;
    let pushError: string | null = null;
    if (ratcheted && t212Settings) {
      if (t212Stop != null && activeStop <= t212Stop + 0.01) {
        log.info({ ticker: trade.ticker, activeStop, t212Stop }, "Skipped push — computed stop is at or below T212 stop");
        pushError = `T212 stop $${t212Stop.toFixed(2)} already at or above $${activeStop.toFixed(2)}`;
      } else {
        try {
          await updateStopOnT212(t212Settings, trade.ticker, trade.shares, activeStop);
          pushed = true;
          result.pushed++;
        } catch (err) {
          pushError = err instanceof Error ? err.message : String(err);
          log.warn({ ticker: trade.ticker, err: pushError }, "Failed to push stop to T212");
        }
      }
    }

    result.results.push({
      ticker: trade.ticker,
      oldStop: currentTrailing,
      newStop: newTrailing,
      activeStop,
      ratcheted,
      pushed,
      error: pushError,
    });
  }

  log.info({ processed: result.processed, ratcheted: result.ratcheted, pushed: result.pushed }, "Ratchet complete");
  return result;
}
