import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { config } from "@/lib/config";
import { getUniverse, hasMinimumLiquidity, filterUniverseByMarket } from "@/lib/universe/tickers";
import type { MarketFilter } from "@/lib/universe/tickers";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { generateSignal } from "@/lib/signals/volumeSignal";
import type { VolumeSignal } from "@/lib/signals/volumeSignal";
import { shouldExit, updateTrailingStop } from "@/lib/signals/exitSignal";
import type { OpenPosition } from "@/lib/signals/exitSignal";
import { calculateMarketRegime } from "@/lib/signals/regimeFilter";

const SCHEDULED_SCAN_TOKEN = process.env.SCHEDULED_SCAN_TOKEN;

async function loadAccountBalance(): Promise<number> {
  const latest = await prisma.accountSnapshot.findFirst({
    orderBy: { date: "desc" },
  });
  if (latest) return latest.balance;
  return config.balance;
}

export async function GET(req: NextRequest) {
  // Validate secret token
  const token = req.nextUrl.searchParams.get("token");
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

    // 1b. Calculate market regime
    const marketRegime = await calculateMarketRegime();

    // 2. Fetch EOD quotes — filtered by market
    const fullUniverse = getUniverse();
    const universe = filterUniverseByMarket(fullUniverse, market);
    const quoteMap = await fetchEODQuotes(universe);
    const fetchedTickers = Object.keys(quoteMap);

    // 3. Filter liquidity
    const liquidTickers = fetchedTickers.filter((ticker) =>
      hasMinimumLiquidity(ticker, quoteMap[ticker]! as any),
    );

    // 4. Generate signals
    const signals: VolumeSignal[] = [];
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
        actionTaken: signal ? "SIGNAL_FIRED" : "NO_SIGNAL",
      };
      await prisma.scanResult.upsert({
        where: { ticker_scanDate: { ticker, scanDate: today } },
        create: scanData,
        update: scanData,
      });

      if (signal) signals.push(signal);
    }

    signals.sort((a, b) => b.volumeRatio - a.volumeRatio);

    // 5. Check open positions
    const openTrades = await prisma.trade.findMany({
      where: { status: "OPEN" },
    });

    // 6. Process exits on open trades in this market
    const tradesExited: Array<{ ticker: string; exitPrice: number; exitReason: string; rMultiple: number }> = [];
    const marketOpenTrades = openTrades.filter((t) =>
      filterUniverseByMarket([t.ticker], market).length > 0,
    );

    for (const trade of marketOpenTrades) {
      const quotes = quoteMap[trade.ticker];
      if (!quotes || quotes.length === 0) continue;

      const latestQuote = quotes[quotes.length - 1]!;
      const currentClose = latestQuote.close;
      const riskPerShare = trade.entryPrice - trade.hardStop;

      if (currentClose < trade.hardStop) {
        const rMultiple = riskPerShare !== 0 ? (currentClose - trade.entryPrice) / riskPerShare : 0;
        tradesExited.push({ ticker: trade.ticker, exitPrice: currentClose, exitReason: "HARD_STOP", rMultiple });
        await prisma.trade.update({
          where: { id: trade.id },
          data: { status: "CLOSED", exitDate: today, exitPrice: currentClose, exitReason: "HARD_STOP", rMultiple },
        });
        continue;
      }

      if (shouldExit(currentClose, quotes)) {
        const rMultiple = riskPerShare !== 0 ? (currentClose - trade.entryPrice) / riskPerShare : 0;
        tradesExited.push({ ticker: trade.ticker, exitPrice: currentClose, exitReason: "TRAILING_STOP", rMultiple });
        await prisma.trade.update({
          where: { id: trade.id },
          data: { status: "CLOSED", exitDate: today, exitPrice: currentClose, exitReason: "TRAILING_STOP", rMultiple },
        });
        continue;
      }

      // Update trailing stop
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
      if (newTrailingStop !== trade.trailingStop) {
        await prisma.trade.update({
          where: { id: trade.id },
          data: { trailingStop: newTrailingStop },
        });
      }

      const currentStop = Math.max(trade.hardStop, trade.trailingStop);
      const newStop = Math.max(trade.hardStop, newTrailingStop);
      const changed = newStop > currentStop;
      await prisma.stopHistory.create({
        data: {
          tradeId: trade.id,
          date: today,
          stopLevel: newStop,
          stopType: newStop > trade.hardStop ? "TRAILING" : "HARD",
          changed,
          changeAmount: changed ? newStop - currentStop : null,
        },
      });
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
    console.error("[/api/scan/scheduled] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scheduled scan failed" },
      { status: 500 },
    );
  }
}
