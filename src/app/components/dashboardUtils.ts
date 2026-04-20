import type { Trade, TradeWithHistory, SyncResult, Instruction, ActionItem } from "./types";
import { tickerCurrency } from "./helpers";

// ── Stop alignment ──────────────────────────────────────────────────────────

export type StopAlignmentState = "none" | "unknown" | "needs_update" | "aligned";

export function calculateStopAlignment(
  openTrades: TradeWithHistory[],
  syncData: Record<string, SyncResult>,
  t212Prices: Record<string, { currentPrice: number; ppl: number; stopLoss: number | null }> | undefined,
  instructions: Instruction[],
  actionItems: ActionItem[],
): StopAlignmentState {
  if (openTrades.length === 0) return "none";

  const hasUnknownStopStatus = openTrades.some((t) => {
    const hasSyncData = Boolean(syncData[t.id]?.t212);
    const hasDashboardData = Boolean(t212Prices?.[t.ticker]);
    return !hasSyncData && !hasDashboardData;
  });

  if (hasUnknownStopStatus) return "unknown";

  const hasStopAction = instructions.some(
    (i) => i.type === "UPDATE_STOP" || i.type === "T212_STOP_BEHIND",
  ) || actionItems.some(
    (a) => a.type === "STOP_UPDATE" || a.type === "STOP_SYNC",
  );

  const hasStopMismatch = openTrades.some((t) => {
    const activeStop = Math.max(t.hardStop, t.trailingStop);
    const stopLoss = syncData[t.id]?.t212?.stopLoss ?? t212Prices?.[t.ticker]?.stopLoss ?? null;
    if (stopLoss == null) return true;
    const tol = activeStop * 0.002;
    return stopLoss < activeStop - tol;
  });

  return (hasStopAction || hasStopMismatch) ? "needs_update" : "aligned";
}

// ── Closed trade performance ────────────────────────────────────────────────

export interface TradeHistoryEntry {
  trade: Trade;
  pnl: number | null;
  runningPnl: number;
  runningR: number;
}

export interface GroupedTicker {
  ticker: string;
  latest: Trade;
  trades: Trade[];
  tradeCount: number;
  totalPnl: number;
  totalR: number;
  history: TradeHistoryEntry[];
}

export interface ClosedPerformance {
  closedOnly: Trade[];
  grouped: GroupedTicker[];
  totalPnl: number;
  totalPnlByCurrency: Record<string, number>;
  totalR: number;
  tickerCount: number;
}

export function groupAndAggregateClosedTrades(closedTrades: Trade[]): ClosedPerformance {
  const closedOnly = [...closedTrades].sort((a, b) => {
    const left = new Date(a.exitDate ?? a.entryDate).getTime();
    const right = new Date(b.exitDate ?? b.entryDate).getTime();
    return right - left;
  });

  const totalPnl = closedOnly.reduce((sum, t) => {
    if (t.exitPrice == null) return sum;
    return sum + (t.exitPrice - t.entryPrice) * t.shares;
  }, 0);

  const totalPnlByCurrency: Record<string, number> = {};
  for (const t of closedOnly) {
    if (t.exitPrice == null) continue;
    const currency = tickerCurrency(t.ticker);
    const pnl = (t.exitPrice - t.entryPrice) * t.shares;
    totalPnlByCurrency[currency] = (totalPnlByCurrency[currency] ?? 0) + pnl;
  }

  const totalR = closedOnly.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);

  const groupedMap = new Map<string, Trade[]>();
  for (const t of closedOnly) {
    const bucket = groupedMap.get(t.ticker) ?? [];
    bucket.push(t);
    groupedMap.set(t.ticker, bucket);
  }

  const grouped = Array.from(groupedMap.entries())
    .map(([ticker, trades]) => {
      const sortedByRecent = [...trades].sort((a, b) => {
        const left = new Date(a.exitDate ?? a.entryDate).getTime();
        const right = new Date(b.exitDate ?? b.entryDate).getTime();
        return right - left;
      });
      const latest = sortedByRecent[0]!;
      const tickerPnl = sortedByRecent.reduce((sum, t) => {
        if (t.exitPrice == null) return sum;
        return sum + (t.exitPrice - t.entryPrice) * t.shares;
      }, 0);
      const tickerR = sortedByRecent.reduce((sum, t) => sum + (t.rMultiple ?? 0), 0);

      const ascending = [...sortedByRecent].sort((a, b) => {
        const left = new Date(a.exitDate ?? a.entryDate).getTime();
        const right = new Date(b.exitDate ?? b.entryDate).getTime();
        return left - right;
      });

      let runningPnl = 0;
      let runningR = 0;
      const history = ascending.map((t) => {
        const pnl = t.exitPrice != null ? (t.exitPrice - t.entryPrice) * t.shares : null;
        runningPnl += pnl ?? 0;
        runningR += t.rMultiple ?? 0;
        return { trade: t, pnl, runningPnl, runningR };
      });

      return {
        ticker,
        latest,
        trades: sortedByRecent,
        tradeCount: sortedByRecent.length,
        totalPnl: tickerPnl,
        totalR: tickerR,
        history,
      };
    })
    .sort((a, b) => {
      const left = new Date(a.latest.exitDate ?? a.latest.entryDate).getTime();
      const right = new Date(b.latest.exitDate ?? b.latest.entryDate).getTime();
      return right - left;
    });

  return {
    closedOnly,
    grouped,
    totalPnl,
    totalPnlByCurrency,
    totalR,
    tickerCount: grouped.length,
  };
}
