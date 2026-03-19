import type { OpenPosition } from "@/lib/signals/exitSignal";

/**
 * Calculate R-multiple for a trade exit.
 */
export function calculateRMultiple(
  exitPrice: number,
  entryPrice: number,
  hardStop: number,
): number {
  const riskPerShare = entryPrice - hardStop;
  return riskPerShare !== 0 ? (exitPrice - entryPrice) / riskPerShare : 0;
}

/**
 * Build prisma data for a StopHistory record.
 */
export function buildStopHistoryData(
  tradeId: string,
  date: Date,
  hardStop: number,
  previousTrailingStop: number,
  newTrailingStop: number,
) {
  const currentStop = Math.max(hardStop, previousTrailingStop);
  const newStop = Math.max(hardStop, newTrailingStop);
  const changed = newStop > currentStop;

  return {
    tradeId,
    date,
    stopLevel: newStop,
    stopType: newStop > hardStop ? "TRAILING" : "HARD",
    changed,
    changeAmount: changed ? newStop - currentStop : null,
  };
}

interface TradeRow {
  ticker: string;
  entryDate: Date;
  entryPrice: number;
  shares: number;
  hardStop: number;
  trailingStop: number;
}

/**
 * Convert a prisma Trade row to an OpenPosition for exit signal calculation.
 */
export function tradeToOpenPosition(trade: TradeRow): OpenPosition {
  return {
    ticker: trade.ticker,
    entryDate: trade.entryDate.toISOString().slice(0, 10),
    entryPrice: trade.entryPrice,
    shares: trade.shares,
    hardStop: trade.hardStop,
    trailingStop: trade.trailingStop,
    currentStop: Math.max(trade.hardStop, trade.trailingStop),
  };
}
