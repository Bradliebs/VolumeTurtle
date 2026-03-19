import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { config } from "@/lib/config";
import { getUniverse, hasMinimumLiquidity, filterUniverseByMarket } from "@/lib/universe/tickers";
import type { MarketFilter } from "@/lib/universe/tickers";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { generateSignal } from "@/lib/signals/volumeSignal";
import type { VolumeSignal } from "@/lib/signals/volumeSignal";
import { shouldExit, updateTrailingStop } from "@/lib/signals/exitSignal";
import { calculateMarketRegime } from "@/lib/signals/regimeFilter";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/scan/scheduled");
import { calculateEquityCurveState } from "@/lib/risk/equityCurve";
import { calculateRMultiple, buildStopHistoryData, tradeToOpenPosition } from "@/lib/trades/utils";
import type { ExitReason } from "@/lib/trades/types";

const SCHEDULED_SCAN_TOKEN = process.env.SCHEDULED_SCAN_TOKEN;

async function loadAccountBalance(): Promise<number> {
  const latest = await prisma.accountSnapshot.findFirst({
    orderBy: { date: "desc" },
  });
  if (latest) return latest.balance;
  return config.balance;
}

export async function GET(req: NextRequest) {
  // Validate secret token (prefer Authorization header, fall back to query param)
  const authHeader = req.headers.get("authorization");
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const queryToken = req.nextUrl.searchParams.get("token");
  const token = headerToken ?? queryToken;
  if (!SCHEDULED_SCAN_TOKEN || !token || token !== SCHEDULED_SCAN_TOKEN) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const marketParam = req.nextUrl.searchParams.get("market") as MarketFilter | null;
  const market: MarketFilter = marketParam === "LSE" || marketParam === "US" || marketParam === "EU" ? marketParam : "ALL";
  const startTime = Date.now();
  const today = new Date();

  // Create ScanRun record
  const scanRun = await prisma.scanRun.create({
    data: {
      startedAt: today,
      status: "RUNNING",
      trigger: "SCHEDULED",
      market,
    },
  });

  try {
    // 1. Load balance
    const accountBalance = await loadAccountBalance();

    // 1a. Calculate equity curve state
    const allSnapshots = await prisma.accountSnapshot.findMany({ orderBy: { date: "asc" } });
    const equityCurveState = calculateEquityCurveState(allSnapshots, config.riskPctPerTrade * 100, config.maxPositions);

    // 1b. Calculate market regime
    const marketRegime = await calculateMarketRegime();

    // 2. Fetch EOD quotes — filtered by market
    const fullUniverse = getUniverse();
    const universe = filterUniverseByMarket(fullUniverse, market);
    const quoteMap = await fetchEODQuotes(universe);
    const fetchedTickers = Object.keys(quoteMap);

    // 3. Filter liquidity
    const liquidTickers = fetchedTickers.filter((ticker) =>
      hasMinimumLiquidity(ticker, quoteMap[ticker]!),
    );

    // 4. Generate signals
    const signals: VolumeSignal[] = [];
    const openCountForAction = await prisma.trade.count({ where: { status: "OPEN" } });
    for (const ticker of liquidTickers) {
      const quotes = quoteMap[ticker]!;
      const signal = generateSignal(ticker, quotes, marketRegime);

      const scanData = {
        scanDate: today,
        ticker,
        signalFired: signal !== null,
        volumeRatio: signal?.volumeRatio ?? null,
        rangePosition: signal?.rangePosition ?? null,
        atr20: signal?.atr20 ?? null,
        compositeScore: signal?.compositeScore?.total ?? null,
        compositeGrade: signal?.compositeScore?.grade ?? null,
        actionTaken: signal
          ? equityCurveState.systemState === "PAUSE"
            ? "SKIPPED_EQUITY_PAUSE"
            : openCountForAction >= config.maxPositions
              ? "SKIPPED_MAX_POSITIONS"
              : "SIGNAL_FIRED"
          : "NO_SIGNAL",
      };
      await prisma.scanResult.upsert({
        where: { ticker_scanDate: { ticker, scanDate: today } },
        create: scanData,
        update: scanData,
      });

      if (signal) signals.push(signal);
    }

    signals.sort((a, b) => (b.compositeScore?.total ?? 0) - (a.compositeScore?.total ?? 0));

    // 5. Check open positions
    const openTrades = await prisma.trade.findMany({
      where: { status: "OPEN" },
    });

    // 6. Process exits on open trades in this market
    const tradesExited: Array<{ ticker: string; exitPrice: number; exitReason: ExitReason; rMultiple: number }> = [];
    const marketOpenTrades = openTrades.filter((t) =>
      filterUniverseByMarket([t.ticker], market).length > 0,
    );

    for (const trade of marketOpenTrades) {
      const quotes = quoteMap[trade.ticker];
      if (!quotes || quotes.length === 0) continue;

      const latestQuote = quotes[quotes.length - 1]!;
      const currentClose = latestQuote.close;

      if (currentClose < trade.hardStop) {
        const rMultiple = calculateRMultiple(currentClose, trade.entryPrice, trade.hardStop);
        tradesExited.push({ ticker: trade.ticker, exitPrice: currentClose, exitReason: "HARD_STOP", rMultiple });
        await prisma.trade.update({
          where: { id: trade.id },
          data: { status: "CLOSED", exitDate: today, exitPrice: currentClose, exitReason: "HARD_STOP", rMultiple },
        });
        continue;
      }

      if (shouldExit(currentClose, quotes)) {
        const rMultiple = calculateRMultiple(currentClose, trade.entryPrice, trade.hardStop);
        tradesExited.push({ ticker: trade.ticker, exitPrice: currentClose, exitReason: "TRAILING_STOP", rMultiple });
        await prisma.trade.update({
          where: { id: trade.id },
          data: { status: "CLOSED", exitDate: today, exitPrice: currentClose, exitReason: "TRAILING_STOP", rMultiple },
        });
        continue;
      }

      // Update trailing stop
      const openPos = tradeToOpenPosition(trade);
      const newTrailingStop = updateTrailingStop(openPos, quotes);
      if (newTrailingStop !== trade.trailingStop) {
        await prisma.trade.update({
          where: { id: trade.id },
          data: { trailingStop: newTrailingStop },
        });
      }

      const stopChanged = newTrailingStop > trade.trailingStop;
      if (stopChanged) {
        await prisma.stopHistory.create({
          data: buildStopHistoryData(trade.id, today, trade.hardStop, trade.trailingStop, newTrailingStop),
        });
      }
    }

    // 7. Save snapshot
    const finalOpenCount = openTrades.length - tradesExited.length;
    await prisma.accountSnapshot.create({
      data: { date: today, balance: accountBalance, openTrades: finalOpenCount },
    });

    const durationMs = Date.now() - startTime;

    // 8. Update ScanRun
    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        completedAt: new Date(),
        tickersScanned: liquidTickers.length,
        signalsFound: signals.length,
        status: "COMPLETED",
        durationMs,
        marketRegime: marketRegime.marketRegime,
        vixLevel: marketRegime.vixLevel,
        qqqVs200MA: marketRegime.qqqPctAboveMA,
      },
    });

    return NextResponse.json({
      success: true,
      market,
      timestamp: new Date().toISOString(),
      tickersScanned: liquidTickers.length,
      signalsFound: signals.length,
      tradesExited: tradesExited.length,
      systemState: equityCurveState.systemState,
      durationMs,
      signals: signals.map((s) => ({
        ticker: s.ticker,
        volumeRatio: s.volumeRatio,
        rangePosition: s.rangePosition,
      })),
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    await prisma.scanRun.update({
      where: { id: scanRun.id },
      data: {
        completedAt: new Date(),
        status: "FAILED",
        error: err instanceof Error ? err.message : "Unknown error",
        durationMs,
      },
    });
    log.error({ err }, "Scheduled scan failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scheduled scan failed" },
      { status: 500 },
    );
  }
}
