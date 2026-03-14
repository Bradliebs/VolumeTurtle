import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { getCurrencySymbol } from "@/lib/currency";

function getNextScheduledRun(hour: number, minute: number): { label: string; iso: string } {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  const isToday = target.getDate() === now.getDate();
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return {
    label: `${isToday ? "Today" : "Tomorrow"} ${hh}:${mm}`,
    iso: target.toISOString(),
  };
}

export async function GET() {
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const [account, openTrades, recentSignals, closedTrades, lastScan, scanHistory, lastLseScan, lastUsScan] =
    await Promise.all([
      prisma.accountSnapshot.findFirst({ orderBy: { date: "desc" } }),
      prisma.trade.findMany({
        where: { status: "OPEN" },
        orderBy: { entryDate: "desc" },
        include: { stopHistory: { orderBy: { date: "asc" } } },
      }),
      prisma.scanResult.findMany({
        where: { scanDate: { gte: fourteenDaysAgo } },
        orderBy: { scanDate: "desc" },
        distinct: ["ticker", "scanDate"],
      }),
      prisma.trade.findMany({
        where: { status: "CLOSED", exitDate: { gte: sixtyDaysAgo } },
        orderBy: { exitDate: "desc" },
      }),
      prisma.scanResult.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.scanRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 20,
      }),
      prisma.scanRun.findFirst({
        where: { market: "LSE", status: "COMPLETED" },
        orderBy: { startedAt: "desc" },
      }),
      prisma.scanRun.findFirst({
        where: { market: "US", status: "COMPLETED" },
        orderBy: { startedAt: "desc" },
      }),
    ]);

  // Compute actions and daily instructions for open trades
  const actions: Array<{
    type: string;
    ticker: string;
    message: string;
    urgency: string;
    stopHistoryId?: string;
  }> = [];

  const instructions: Array<{
    ticker: string;
    currency: string;
    type: "HOLD" | "UPDATE_STOP" | "EXIT";
    currentStop: number;
    stopSetDate: string | null;
    latestClose: number | null;
    oldStop: number | null;
    newStop: number | null;
    changeAmount: number | null;
    breakAmount: number | null;
    actioned: boolean;
  }> = [];

  if (openTrades.length > 0) {
    const openTickers = openTrades.map((t) => t.ticker);
    let quoteMap: Record<string, Array<{ close: number }>> = {};
    try {
      quoteMap = await fetchEODQuotes(openTickers);
    } catch {
      // If quote fetch fails, we still show instructions with what we have
    }

    for (const trade of openTrades) {
      const quotes = quoteMap[trade.ticker];
      const latestClose = quotes && quotes.length > 0 ? quotes[quotes.length - 1]!.close : null;
      const currentStop = Math.max(trade.hardStop, trade.trailingStop);
      const c = getCurrencySymbol(trade.ticker);
      const stopHistory = trade.stopHistory ?? [];
      const lastStopEntry = stopHistory.length > 0 ? stopHistory[stopHistory.length - 1] : null;
      const stopChanged = trade.trailingStop > trade.hardStop;

      // Find unactioned stop update
      const unactionedUpdate = stopHistory.find((sh) => sh.changed && !sh.actioned);

      if (latestClose !== null && latestClose < currentStop) {
        // EXIT
        const breakAmount = currentStop - latestClose;
        instructions.push({
          ticker: trade.ticker,
          currency: c,
          type: "EXIT",
          currentStop,
          stopSetDate: lastStopEntry?.date?.toISOString() ?? null,
          latestClose,
          oldStop: null,
          newStop: null,
          changeAmount: null,
          breakAmount,
          actioned: false,
        });
        actions.push({
          type: "EXIT",
          ticker: trade.ticker,
          message: `EXIT — close ${c}${latestClose.toFixed(2)} broke stop ${c}${currentStop.toFixed(2)}`,
          urgency: "HIGH",
        });
      } else if (stopChanged && unactionedUpdate) {
        // UPDATE STOP
        instructions.push({
          ticker: trade.ticker,
          currency: c,
          type: "UPDATE_STOP",
          currentStop,
          stopSetDate: lastStopEntry?.date?.toISOString() ?? null,
          latestClose,
          oldStop: trade.hardStop,
          newStop: trade.trailingStop,
          changeAmount: unactionedUpdate.changeAmount,
          breakAmount: null,
          actioned: false,
        });
        actions.push({
          type: "STOP_UPDATE",
          ticker: trade.ticker,
          message: `Move stop UP to ${c}${trade.trailingStop.toFixed(2)} (was ${c}${trade.hardStop.toFixed(2)})`,
          urgency: "MEDIUM",
          stopHistoryId: unactionedUpdate.id,
        });
      } else {
        // HOLD
        const lastActioned = stopChanged && !unactionedUpdate;
        instructions.push({
          ticker: trade.ticker,
          currency: c,
          type: "HOLD",
          currentStop,
          stopSetDate: lastStopEntry?.date?.toISOString() ?? trade.createdAt.toISOString(),
          latestClose,
          oldStop: null,
          newStop: null,
          changeAmount: null,
          breakAmount: null,
          actioned: lastActioned,
        });
      }
    }
  }

  // Sort actions: EXIT first, then STOP_UPDATE
  actions.sort((a, b) => (a.type === "EXIT" ? -1 : 1) - (b.type === "EXIT" ? -1 : 1));

  // Build schedule status
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  function isScanToday(scan: { startedAt: Date } | null): boolean {
    if (!scan) return false;
    return scan.startedAt.toISOString().slice(0, 10) === todayStr;
  }

  const lseNext = getNextScheduledRun(17, 30);
  const usNext = getNextScheduledRun(22, 0);

  const scheduledScans = {
    lse: {
      nextRun: lseNext.label,
      nextRunIso: lseNext.iso,
      lastRun: lastLseScan?.startedAt?.toISOString() ?? null,
      lastRunSignals: lastLseScan?.signalsFound ?? null,
      missed: !isScanToday(lastLseScan) && today.getHours() >= 18,
    },
    us: {
      nextRun: usNext.label,
      nextRunIso: usNext.iso,
      lastRun: lastUsScan?.startedAt?.toISOString() ?? null,
      lastRunSignals: lastUsScan?.signalsFound ?? null,
      missed: !isScanToday(lastUsScan) && today.getHours() >= 22,
    },
  };

  return NextResponse.json({
    account,
    openTrades,
    recentSignals,
    closedTrades,
    lastScanTime: lastScan?.createdAt?.toISOString() ?? null,
    actions,
    instructions,
    scheduledScans,
    scanHistory: scanHistory.map((s) => ({
      id: s.id,
      startedAt: s.startedAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
      tickersScanned: s.tickersScanned,
      signalsFound: s.signalsFound,
      status: s.status,
      trigger: s.trigger,
      market: s.market,
      durationMs: s.durationMs,
    })),
  });
}
