import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { getCurrencySymbol, getGbpUsdRate } from "@/lib/currency";
import { calculateMarketRegime } from "@/lib/signals/regimeFilter";
import type { RegimeState } from "@/lib/signals/regimeFilter";
import { calculateEquityCurveState } from "@/lib/risk/equityCurve";
import { config } from "@/lib/config";
import { loadT212Settings, getCachedT212Positions } from "@/lib/t212/client";
import type { T212Position } from "@/lib/t212/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import { calculateATR20 } from "@/lib/risk/atr";
import { calculateTrailingLow } from "@/lib/signals/exitSignal";
import { findDuplicateClosedEntryIds, findDuplicateClosedTradeIds, findPhantomClosedTradeIds } from "@/lib/trades/status";

const log = createLogger("api/dashboard");

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

export async function GET(req: Request) {
  // Rate limit: max 30 requests per minute
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const url = new URL(req.url);
  const closedTradesPage = parseInt(url.searchParams.get("closedPage") ?? "1", 10);
  const signalsPage = parseInt(url.searchParams.get("signalsPage") ?? "1", 10);
  const pageSize = config.dashboardPageSize;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [account, openTrades, recentSignals, rawClosedTrades, lastScan, scanHistory, lastLseScan, lastUsScan, lastBackupSetting] =
    await Promise.all([
      prisma.accountSnapshot.findFirst({ orderBy: { date: "desc" } }),
      prisma.trade.findMany({
        where: { status: "OPEN" },
        orderBy: { entryDate: "desc" },
        include: { stopHistory: { orderBy: { date: "asc" } } },
      }),
      prisma.scanResult.findMany({
        where: { scanDate: { gte: thirtyDaysAgo }, signalFired: true },
        orderBy: { scanDate: "desc" },
        distinct: ["ticker", "scanDate"],
        take: pageSize,
        skip: (signalsPage - 1) * pageSize,
      }),
      prisma.trade.findMany({
        where: { status: "CLOSED" },
        orderBy: { exitDate: "desc" },
        take: pageSize,
        skip: (closedTradesPage - 1) * pageSize,
      }),
      prisma.scanResult.findFirst({
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.scanRun.findMany({
        orderBy: { startedAt: "desc" },
        take: config.dashboardPageSize,
      }),
      prisma.scanRun.findFirst({
        where: { market: "LSE", status: "COMPLETED" },
        orderBy: { startedAt: "desc" },
      }),
      prisma.scanRun.findFirst({
        where: { market: "US", status: "COMPLETED" },
        orderBy: { startedAt: "desc" },
      }),
      prisma.settings.findUnique({ where: { key: "last_backup_at" } }),
    ]);

  // Get total counts for pagination
  const [rawTotalClosedTrades, totalSignals] = await Promise.all([
    prisma.trade.count({ where: { status: "CLOSED" } }),
    prisma.scanResult.count({ where: { scanDate: { gte: thirtyDaysAgo }, signalFired: true } }),
  ]);

  let closedTrades = rawClosedTrades;
  let totalClosedTrades = rawTotalClosedTrades;

  const duplicateClosedEntryIds = findDuplicateClosedEntryIds(rawClosedTrades);
  if (duplicateClosedEntryIds.size > 0) {
    closedTrades = closedTrades.filter((trade) => !duplicateClosedEntryIds.has(trade.id));
    totalClosedTrades = Math.max(0, totalClosedTrades - duplicateClosedEntryIds.size);
  }

  // Fetch current market regime (QQQ + VIX)
  let regime: RegimeState | null = null;
  try {
    regime = await calculateMarketRegime();
  } catch (err) {
    log.warn({ err }, "Market regime fetch failed, continuing without");
  }

  // Fetch latest breadth data from most recent ScanRun
  let breadthData: Record<string, unknown> | null = null;
  try {
    const latestBreadth = await (prisma as unknown as {
      scanRun: {
        findFirst: (args: unknown) => Promise<{
          breadthScore: number | null;
          breadthSignal: string | null;
          breadthTrend: string | null;
          above50MAPct: number | null;
          above200MAPct: number | null;
          newHighLowRatio: number | null;
          advanceDeclinePct: number | null;
          startedAt: Date;
        } | null>;
        findMany: (args: unknown) => Promise<Array<{ startedAt: Date; breadthScore: number | null }>>;
      };
    }).scanRun.findFirst({
      where: { breadthScore: { not: null } },
      orderBy: { startedAt: "desc" },
    });
    if (latestBreadth?.breadthScore != null) {
      // Get history for sparkline
      const breadthHistory = await (prisma as unknown as {
        scanRun: {
          findMany: (args: unknown) => Promise<Array<{ startedAt: Date; breadthScore: number | null }>>;
        };
      }).scanRun.findMany({
        where: { breadthScore: { not: null } },
        orderBy: { startedAt: "desc" },
        take: 30,
        select: { startedAt: true, breadthScore: true },
      });
      breadthData = {
        above50MA: latestBreadth.above50MAPct ?? 0,
        above200MA: latestBreadth.above200MAPct ?? 0,
        above50MA_count: 0,
        above200MA_count: 0,
        totalMeasured: 0,
        newHighs: 0,
        newLows: 0,
        newHighLowRatio: latestBreadth.newHighLowRatio ?? 0,
        advanceDecline: latestBreadth.advanceDeclinePct ?? 0,
        breadthScore: latestBreadth.breadthScore,
        breadthSignal: latestBreadth.breadthSignal ?? "NEUTRAL",
        breadthTrend: latestBreadth.breadthTrend ?? "STABLE",
        warning: null,
        history: breadthHistory.reverse().map((r) => ({
          date: r.startedAt.toISOString(),
          score: r.breadthScore,
        })),
      };
    }
  } catch {
    // Breadth unavailable — continue without
  }

  // Fetch GBP/USD rate for exposure conversion
  let gbpUsdRate = 1.27;
  try {
    gbpUsdRate = await getGbpUsdRate();
  } catch {
    // Use fallback
  }

  // Calculate equity curve state
  const allSnapshots = await prisma.accountSnapshot.findMany({ orderBy: { date: "asc" } });
  const equityCurveState = calculateEquityCurveState(allSnapshots, config.riskPctPerTrade * 100, config.maxPositions);
  const sparklineSnapshots = allSnapshots.slice(-30).map((s) => ({
    date: s.date.toISOString().slice(0, 10),
    balance: s.balance,
  }));

  // Fetch T212 portfolio (always, regardless of open trades)
  // Uses shared cache to survive 429 rate limiting across routes
  let t212Positions: T212Position[] = [];
  let t212Loaded = false;
  const t212Settings = loadT212Settings();
  if (t212Settings) {
    try {
      const cached = await getCachedT212Positions(t212Settings);
      t212Positions = cached.positions;
      t212Loaded = true;
    } catch (err) {
      log.warn({ err }, "T212 fetch failed");
    }
  }

  const openTickers = Array.from(new Set(openTrades.map((trade) => trade.ticker)));
  if (openTickers.length > 0) {
    const candidateDuplicateClosedTrades = await prisma.trade.findMany({
      where: {
        status: "CLOSED",
        ticker: { in: openTickers },
      },
      select: {
        id: true,
        ticker: true,
        entryDate: true,
        exitDate: true,
        entryPrice: true,
        shares: true,
      },
    });

    const duplicateClosedTradeIds = findDuplicateClosedTradeIds({
      openTrades,
      closedTrades: candidateDuplicateClosedTrades,
    });

    if (duplicateClosedTradeIds.size > 0) {
      closedTrades = rawClosedTrades.filter((trade) => !duplicateClosedTradeIds.has(trade.id));
      totalClosedTrades = Math.max(0, totalClosedTrades - duplicateClosedTradeIds.size);
    }
  }

  if (t212Loaded && t212Positions.length > 0) {
    const heldTickers = Array.from(new Set(t212Positions.map((position) => position.ticker)));
    const openTickerSet = new Set(openTrades.map((trade) => trade.ticker));
    const heldUntrackedTickers = heldTickers.filter((ticker) => !openTickerSet.has(ticker));

    if (heldUntrackedTickers.length > 0) {
      const candidateClosedTrades = await prisma.trade.findMany({
        where: {
          status: "CLOSED",
          ticker: { in: heldUntrackedTickers },
        },
        select: {
          id: true,
          ticker: true,
          entryDate: true,
          exitDate: true,
        },
      });

      const phantomClosedTradeIds = findPhantomClosedTradeIds({
        openTrades,
        closedTrades: candidateClosedTrades,
        heldTickers,
      });

      if (phantomClosedTradeIds.size > 0) {
        closedTrades = closedTrades.filter((trade) => !phantomClosedTradeIds.has(trade.id));
        totalClosedTrades = Math.max(0, totalClosedTrades - phantomClosedTradeIds.size);
      }
    }
  }

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
    type: "HOLD" | "UPDATE_STOP" | "EXIT" | "T212_EXIT" | "T212_STOP_BEHIND";
    currentStop: number;
    stopSetDate: string | null;
    latestClose: number | null;
    oldStop: number | null;
    newStop: number | null;
    changeAmount: number | null;
    breakAmount: number | null;
    actioned: boolean;
    t212Stop: number | null;
  }> = [];

  if (openTrades.length > 0) {
    const openTickers = openTrades.map((t) => t.ticker);
    let quoteMap: Record<string, Array<{ close: number }>> = {};
    try {
      quoteMap = await fetchEODQuotes(openTickers);
    } catch (err) {
      log.warn({ err }, "Quote fetch failed, continuing with stale data");
    }

    for (const trade of openTrades) {
      // If T212 loaded and position is gone, flag it immediately
      const t212Match = t212Loaded ? t212Positions.find((p) => p.ticker === trade.ticker) : undefined;
      const goneFromT212 = t212Loaded && !t212Match;
      const quotes = quoteMap[trade.ticker];
      const latestClose = quotes && quotes.length > 0 ? quotes[quotes.length - 1]!.close : null;
      const currentStop = Math.max(trade.hardStop, trade.trailingStop);
      const c = getCurrencySymbol(trade.ticker);
      const stopHistory = trade.stopHistory ?? [];
      const lastStopEntry = stopHistory.length > 0 ? stopHistory[stopHistory.length - 1] : null;
      const stopChanged = trade.trailingStop > trade.hardStop;

      // Find unactioned stop update
      const unactionedUpdate = stopHistory.find((sh) => sh.changed && !sh.actioned);

      if (goneFromT212) {
        // Position no longer on T212 — stop was hit intraday or manually sold
        instructions.push({
          ticker: trade.ticker,
          currency: c,
          type: "T212_EXIT",
          currentStop,
          stopSetDate: lastStopEntry?.date?.toISOString() ?? null,
          latestClose,
          oldStop: null,
          newStop: null,
          changeAmount: null,
          breakAmount: null,
          actioned: false,
          t212Stop: null,
        });
        actions.push({
          type: "EXIT",
          ticker: trade.ticker,
          message: `EXIT — position no longer held on T212. Sync to close at stop ${c}${currentStop.toFixed(2)}.`,
          urgency: "HIGH",
        });
      } else if (latestClose !== null && latestClose < currentStop) {
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
          t212Stop: t212Match?.stopLoss ?? null,
        });
        actions.push({
          type: "EXIT",
          ticker: trade.ticker,
          message: `EXIT — close ${c}${latestClose.toFixed(2)} broke stop ${c}${currentStop.toFixed(2)}`,
          urgency: "HIGH",
        });
      } else if (stopChanged && unactionedUpdate) {
        // UPDATE STOP — but check if T212 already has a stop >= our new level
        const t212StopValue = t212Match?.stopLoss ?? null;
        const t212AlreadyAhead = t212StopValue !== null && t212StopValue >= currentStop - 0.01;

        if (t212AlreadyAhead) {
          // T212 stop is already at or above our system stop — no user action needed
          // Auto-mark as actioned since T212 is already protecting the position
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
            actioned: true,
            t212Stop: t212StopValue,
          });
        } else {
          const previousStopLevel = unactionedUpdate.stopLevel - (unactionedUpdate.changeAmount ?? 0);
          instructions.push({
            ticker: trade.ticker,
            currency: c,
            type: "UPDATE_STOP",
            currentStop,
            stopSetDate: lastStopEntry?.date?.toISOString() ?? null,
            latestClose,
            oldStop: previousStopLevel,
            newStop: trade.trailingStop,
            changeAmount: unactionedUpdate.changeAmount,
            breakAmount: null,
            actioned: false,
            t212Stop: t212StopValue,
          });
          actions.push({
            type: "STOP_UPDATE",
            ticker: trade.ticker,
            message: `Move stop UP to ${c}${trade.trailingStop.toFixed(2)} (was ${c}${previousStopLevel.toFixed(2)})`,
            urgency: "MEDIUM",
            stopHistoryId: unactionedUpdate.id,
          });
        }
      } else {
        // Check if T212 stop is behind the system's active stop
        const t212StopValue = t212Match?.stopLoss ?? null;
        const t212Behind = t212StopValue !== null && t212StopValue < currentStop - 0.01;

        if (t212Behind) {
          // T212 STOP BEHIND — needs to be raised to match system stop
          instructions.push({
            ticker: trade.ticker,
            currency: c,
            type: "T212_STOP_BEHIND",
            currentStop,
            stopSetDate: lastStopEntry?.date?.toISOString() ?? trade.createdAt.toISOString(),
            latestClose,
            oldStop: t212StopValue,
            newStop: currentStop,
            changeAmount: currentStop - t212StopValue!,
            breakAmount: null,
            actioned: false,
            t212Stop: t212StopValue,
          });
          actions.push({
            type: "STOP_SYNC",
            ticker: trade.ticker,
            message: `T212 stop ${c}${t212StopValue!.toFixed(2)} is below system stop ${c}${currentStop.toFixed(2)} — update on T212`,
            urgency: "MEDIUM",
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
            t212Stop: t212StopValue,
          });
        }
      }
    }
  }

  // Sort actions: EXIT first, then STOP_UPDATE/STOP_SYNC, then others
  actions.sort((a, b) => {
    if (a.type === "EXIT" && b.type !== "EXIT") return -1;
    if (a.type !== "EXIT" && b.type === "EXIT") return 1;
    if ((a.type === "STOP_UPDATE" || a.type === "STOP_SYNC") && b.type !== "STOP_UPDATE" && b.type !== "STOP_SYNC") return -1;
    if ((b.type === "STOP_UPDATE" || b.type === "STOP_SYNC") && a.type !== "STOP_UPDATE" && a.type !== "STOP_SYNC") return 1;
    return 0;
  });

  // Build schedule status
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  function isScanToday(scan: { startedAt: Date } | null): boolean {
    if (!scan) return false;
    return scan.startedAt.toISOString().slice(0, 10) === todayStr;
  }

  const lseNext = getNextScheduledRun(config.lseScanHour, config.lseScanMinute);
  const usNext = getNextScheduledRun(config.usScanHour, config.usScanMinute);

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

  // Build T212 portfolio with scan cross-reference (single batched query)
  let t212Portfolio: Array<{
    ticker: string;
    quantity: number;
    averagePrice: number;
    currentPrice: number;
    ppl: number;
    stopLoss: number | null;
    tracked: boolean;
    suggestedHardStop: number | null;
    suggestedTrailingStop: number | null;
    suggestedActiveStop: number | null;
    atr20: number | null;
    scanHistory: Array<{
      date: string;
      signalFired: boolean;
      compositeGrade: string | null;
      compositeScore: number | null;
      volumeRatio: number | null;
      rangePosition: number | null;
      actionTaken: string | null;
    }>;
    lastSignalDate: string | null;
    lastSignalGrade: string | null;
    tradeStatus: string | null;
  }> | null = null;

  if (t212Loaded && t212Positions.length > 0) {
    try {
      const t212Tickers = t212Positions.map((p) => p.ticker);

      // Fetch scan results and quotes in parallel
      const [allScanResults, t212QuoteMap] = await Promise.all([
        prisma.scanResult.findMany({
          where: { ticker: { in: t212Tickers } },
          orderBy: { scanDate: "desc" },
        }),
        fetchEODQuotes(t212Tickers).catch((err) => {
          log.warn({ err }, "T212 quote fetch failed");
          return {} as Record<string, Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>>;
        }),
      ]);

      // Group by ticker, keep last 5 per ticker
      const scanByTicker: Record<string, typeof allScanResults> = {};
      for (const s of allScanResults) {
        if (!scanByTicker[s.ticker]) scanByTicker[s.ticker] = [];
        if (scanByTicker[s.ticker]!.length < 5) scanByTicker[s.ticker]!.push(s);
      }

      t212Portfolio = t212Positions.map((p) => {
        const scanResults = scanByTicker[p.ticker] ?? [];
        const lastSignal = scanResults.find((s) => s.signalFired) ?? null;
        const trade = openTrades.find((t) => t.ticker === p.ticker)
          ?? closedTrades.find((t) => t.ticker === p.ticker)
          ?? null;

        // Calculate suggested stops from quote data
        const quotes = t212QuoteMap[p.ticker] ?? [];
        const atr20 = calculateATR20(quotes);
        const trailingLow = calculateTrailingLow(quotes);
        const matchedTrade = openTrades.find((t) => t.ticker === p.ticker);
        const isTracked = !!matchedTrade;

        // For tracked positions, use the database trade stops (same source as Daily Instructions)
        // For untracked positions, calculate fresh from market data
        const suggestedHardStop = isTracked
          ? matchedTrade!.hardStop
          : atr20 != null ? p.currentPrice - (config.hardStopAtrMultiple * atr20) : null;
        const suggestedTrailingStop = isTracked
          ? matchedTrade!.trailingStop
          : trailingLow;
        const suggestedActiveStop = isTracked
          ? Math.max(matchedTrade!.hardStop, matchedTrade!.trailingStop)
          : suggestedHardStop != null && suggestedTrailingStop != null
            ? Math.max(suggestedHardStop, suggestedTrailingStop)
            : suggestedHardStop ?? suggestedTrailingStop;

        return {
          ticker: p.ticker,
          quantity: p.quantity,
          averagePrice: p.averagePrice,
          currentPrice: p.currentPrice,
          ppl: p.ppl,
          stopLoss: p.stopLoss ?? null,
          tracked: isTracked,
          suggestedHardStop,
          suggestedTrailingStop,
          suggestedActiveStop,
          atr20,
          scanHistory: scanResults.map((s) => ({
            date: s.scanDate.toISOString(),
            signalFired: s.signalFired,
            compositeGrade: s.compositeGrade,
            compositeScore: s.compositeScore,
            volumeRatio: s.volumeRatio,
            rangePosition: s.rangePosition,
            actionTaken: s.actionTaken,
          })),
          lastSignalDate: lastSignal?.scanDate?.toISOString() ?? null,
          lastSignalGrade: lastSignal?.compositeGrade ?? null,
          tradeStatus: trade?.status ?? null,
        };
      });
    } catch (err) {
      log.warn({ err }, "T212 scan cross-reference failed, returning basic portfolio");
      t212Portfolio = t212Positions.map((p) => ({
        ticker: p.ticker,
        quantity: p.quantity,
        averagePrice: p.averagePrice,
        currentPrice: p.currentPrice,
        ppl: p.ppl,
        stopLoss: p.stopLoss ?? null,
        tracked: openTrades.some((t) => t.ticker === p.ticker),
        suggestedHardStop: null,
        suggestedTrailingStop: null,
        suggestedActiveStop: null,
        atr20: null,
        scanHistory: [],
        lastSignalDate: null,
        lastSignalGrade: null,
        tradeStatus: null,
      }));
    }
  }

  // Build T212 price lookup for open trades (so UI can show T212 prices without sync)
  const t212Prices: Record<string, { currentPrice: number; ppl: number; stopLoss: number | null }> = {};
  if (t212Loaded) {
    for (const p of t212Positions) {
      t212Prices[p.ticker] = {
        currentPrice: p.currentPrice,
        ppl: p.ppl,
        stopLoss: p.stopLoss ?? null,
      };
    }
  }

  // Build synthetic signal log entries for imported/manual trades not in ScanResult
  const signalTickers = new Set(recentSignals.map((s) => s.ticker));
  const allTrades = [...openTrades, ...closedTrades];
  const syntheticSignals = allTrades
    .filter((t) => !signalTickers.has(t.ticker) && (t.importedFromT212 || t.manualEntry))
    .map((t) => ({
      id: `synth-${t.id}`,
      scanDate: t.entryDate,
      ticker: t.ticker,
      signalFired: true,
      volumeRatio: t.volumeRatio > 0 ? t.volumeRatio : null,
      rangePosition: t.rangePosition > 0 ? t.rangePosition : null,
      atr20: t.atr20 > 0 ? t.atr20 : null,
      compositeScore: (t as unknown as { signalScore?: number }).signalScore ?? null,
      compositeGrade: (t as unknown as { signalGrade?: string }).signalGrade ?? null,
      actionTaken: t.importedFromT212 ? "IMPORTED" : "MANUAL",
      signalSource: t.importedFromT212 ? "import" : (t as unknown as { signalSource?: string }).signalSource ?? "manual",
    }));

  const combinedSignals = [...recentSignals.map((s) => ({
    ...s,
    scanDate: s.scanDate,
    signalSource: "volume" as string,
  })), ...syntheticSignals];

  return NextResponse.json({
    account,
    openTrades,
    recentSignals: combinedSignals,
    closedTrades,
    lastScanTime: lastScan?.createdAt?.toISOString() ?? null,
    actions,
    instructions,
    scheduledScans,
    lastBackupAt: lastBackupSetting?.value ?? null,
    t212Prices,
    regime: regime
      ? {
          marketRegime: regime.marketRegime,
          qqqClose: regime.qqqClose,
          qqq200MA: regime.qqq200MA,
          qqqPctAboveMA: regime.qqqPctAboveMA,
          volatilityRegime: regime.volatilityRegime,
          vixLevel: regime.vixLevel,
          asOf: regime.asOf,
        }
      : null,
    breadth: breadthData,
    equityCurve: {
      systemState: equityCurveState.systemState,
      currentBalance: equityCurveState.currentBalance,
      peakBalance: equityCurveState.peakBalance,
      drawdownPct: equityCurveState.drawdownPct,
      drawdownAbs: equityCurveState.drawdownAbs,
      equityMA20: equityCurveState.equityMA20,
      aboveEquityMA: equityCurveState.aboveEquityMA,
      riskPctPerTrade: equityCurveState.riskPctPerTrade,
      maxPositions: equityCurveState.maxPositions,
      reason: equityCurveState.reason,
    },
    sparklineSnapshots,
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
      marketRegime: s.marketRegime,
      vixLevel: s.vixLevel,
    })),
    pagination: {
      closedTrades: {
        page: closedTradesPage,
        pageSize,
        total: totalClosedTrades,
        totalPages: Math.ceil(totalClosedTrades / pageSize),
      },
      signals: {
        page: signalsPage,
        pageSize,
        total: totalSignals,
        totalPages: Math.ceil(totalSignals / pageSize),
      },
    },
    t212Portfolio,

    // FX rate for exposure conversion
    gbpUsdRate,

    // Momentum summary — convergence with volume engine
    momentumSummary: await buildMomentumSummary(recentSignals),
  });
}

async function buildMomentumSummary(recentSignals: Array<{ ticker: string; signalFired: boolean; scanDate: Date }>) {
  const db = prisma as unknown as {
    sectorScanResult: { findFirst: (a: unknown) => Promise<{ sector: string; score: number; runAt: Date } | null>; findMany: (a: unknown) => Promise<unknown[]> };
    momentumSignal: { findMany: (a: unknown) => Promise<Array<{ ticker: string; grade: string; status: string; createdAt: Date }>>; count: (a: unknown) => Promise<number> };
  };

  const topSector = await db.sectorScanResult.findFirst({
    orderBy: { score: "desc" },
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const recentMomentum = await db.momentumSignal.findMany({
    where: { status: "active", createdAt: { gte: todayStart } },
  });

  const nearMissCount = await db.momentumSignal.count({
    where: { status: "near-miss", createdAt: { gte: todayStart } },
  });

  const gradeBreakdown = { A: 0, B: 0, C: 0, D: 0 };
  for (const s of recentMomentum) {
    if (s.grade in gradeBreakdown) gradeBreakdown[s.grade as keyof typeof gradeBreakdown]++;
  }

  // Convergence: tickers flagged by BOTH volume and momentum engines today
  const volumeTickers = new Set(
    recentSignals.filter((s) => s.signalFired).map((s) => s.ticker),
  );
  const momentumTickers = new Set(recentMomentum.map((s) => s.ticker));
  const convergenceTickers: string[] = [];
  for (const t of momentumTickers) {
    if (volumeTickers.has(t)) convergenceTickers.push(t);
  }

  return {
    topSector: topSector?.sector ?? null,
    topSectorScore: topSector?.score ?? null,
    signalCount: recentMomentum.length,
    nearMissCount,
    gradeBreakdown,
    convergenceCount: convergenceTickers.length,
    convergenceTickers,
  };
}
