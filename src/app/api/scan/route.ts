import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { config } from "@/lib/config";
import { getUniverse, hasMinimumLiquidity } from "@/lib/universe/tickers";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { generateSignal, calculateAverageVolume, isVolumeSpike, isPriceConfirmed } from "@/lib/signals/volumeSignal";
import type { VolumeSignal } from "@/lib/signals/volumeSignal";
import { shouldExit, updateTrailingStop } from "@/lib/signals/exitSignal";
import type { OpenPosition } from "@/lib/signals/exitSignal";
import { calculatePositionSize } from "@/lib/risk/positionSizer";
import { getCurrencySymbol } from "@/lib/currency";
import { calculateMarketRegime } from "@/lib/signals/regimeFilter";
import { calculateEquityCurveState } from "@/lib/risk/equityCurve";

async function loadAccountBalance(): Promise<number> {
  const latest = await prisma.accountSnapshot.findFirst({
    orderBy: { date: "desc" },
  });
  if (latest) return latest.balance;
  return config.balance;
}

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get("dry") !== "false";
  const today = new Date();
  const startTime = Date.now();
  let scanRunId: number | null = null;

  try {
    // Create ScanRun record (unless dry run)
    if (!dryRun) {
      const scanRun = await prisma.scanRun.create({
        data: { startedAt: today, status: "RUNNING", trigger: "MANUAL", market: "ALL" },
      });
      scanRunId = scanRun.id;
    }

    // 1. Load balance
    const accountBalance = await loadAccountBalance();

    // 1a. Calculate equity curve state
    const allSnapshots = await prisma.accountSnapshot.findMany({ orderBy: { date: "asc" } });
    const equityCurveState = calculateEquityCurveState(allSnapshots, config.riskPctPerTrade * 100, config.maxPositions);

    // 1b. Calculate market regime (once per scan)
    const marketRegime = await calculateMarketRegime();

    // 2. Fetch EOD quotes
    const universe = getUniverse();
    const quoteMap = await fetchEODQuotes(universe);
    const fetchedTickers = Object.keys(quoteMap);

    // 3. Filter liquidity
    const liquidTickers = fetchedTickers.filter((ticker) =>
      hasMinimumLiquidity(ticker, quoteMap[ticker]! as any),
    );

    // 4. Generate signals + collect near misses
    const signals: VolumeSignal[] = [];
    const nearMisses: Array<{ ticker: string; volumeRatio: number; rangePosition: number; failedOn: "VOLUME" | "RANGE" | "LIQUIDITY" }> = [];

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
      if (!dryRun) {
        await prisma.scanResult.upsert({
          where: { ticker_scanDate: { ticker, scanDate: today } },
          create: scanData,
          update: scanData,
        });
      }

      if (signal) {
        signals.push(signal);
      } else {
        // Check for near miss
        const last = quotes[quotes.length - 1];
        if (last) {
          const avgVol = calculateAverageVolume(quotes, config.atrPeriod);
          const volRatio = avgVol > 0 ? last.volume / avgVol : 0;
          const rangePos = last.high !== last.low ? (last.close - last.low) / (last.high - last.low) : 0;
          const spiked = isVolumeSpike(quotes);
          const confirmed = isPriceConfirmed(last);

          if ((volRatio >= 1.5 || rangePos >= 0.75) && !(spiked && confirmed)) {
            nearMisses.push({
              ticker,
              volumeRatio: volRatio,
              rangePosition: rangePos,
              failedOn: !spiked ? "VOLUME" : "RANGE",
            });
          }
        }
      }
    }

    signals.sort((a, b) => b.volumeRatio - a.volumeRatio);

    // 5. Check open positions
    const openTrades = await prisma.trade.findMany({
      where: { status: "OPEN" },
    });
    let openCount = openTrades.length;

    // 6. Process exits
    const tradesExited: Array<{ ticker: string; exitPrice: number; exitReason: string; rMultiple: number }> = [];
    for (const trade of openTrades) {
      const quotes = quoteMap[trade.ticker];
      if (!quotes || quotes.length === 0) continue;

      const latestQuote = quotes[quotes.length - 1]!;
      const currentClose = latestQuote.close;
      const riskPerShare = trade.entryPrice - trade.hardStop;

      if (currentClose < trade.hardStop) {
        const rMultiple = riskPerShare !== 0 ? (currentClose - trade.entryPrice) / riskPerShare : 0;
        tradesExited.push({ ticker: trade.ticker, exitPrice: currentClose, exitReason: "HARD_STOP", rMultiple });
        if (!dryRun) {
          await prisma.trade.update({
            where: { id: trade.id },
            data: { status: "CLOSED", exitDate: today, exitPrice: currentClose, exitReason: "HARD_STOP", rMultiple },
          });
        }
        continue;
      }

      if (shouldExit(currentClose, quotes)) {
        const rMultiple = riskPerShare !== 0 ? (currentClose - trade.entryPrice) / riskPerShare : 0;
        tradesExited.push({ ticker: trade.ticker, exitPrice: currentClose, exitReason: "TRAILING_STOP", rMultiple });
        if (!dryRun) {
          await prisma.trade.update({
            where: { id: trade.id },
            data: { status: "CLOSED", exitDate: today, exitPrice: currentClose, exitReason: "TRAILING_STOP", rMultiple },
          });
        }
        continue;
      }

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
      if (newTrailingStop !== trade.trailingStop && !dryRun) {
        await prisma.trade.update({
          where: { id: trade.id },
          data: { trailingStop: newTrailingStop },
        });
      }

      // Write stop history record
      const currentStop = Math.max(trade.hardStop, trade.trailingStop);
      const newStop = Math.max(trade.hardStop, newTrailingStop);
      const changed = newStop > currentStop;

      if (!dryRun) {
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
    }

    // 7. Save snapshot
    const finalOpenCount = openCount - tradesExited.length;
    if (!dryRun) {
      await prisma.accountSnapshot.create({
        data: { date: today, balance: accountBalance, openTrades: finalOpenCount },
      });
    }

    // Sort near misses by volumeRatio desc, cap at 5
    nearMisses.sort((a, b) => b.volumeRatio - a.volumeRatio);
    const topNearMisses = nearMisses.slice(0, 5);

    // Update ScanRun record
    if (scanRunId != null) {
      const durationMs = Date.now() - startTime;
      await prisma.scanRun.update({
        where: { id: scanRunId },
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
    }

    return NextResponse.json({
      date: today.toISOString().slice(0, 10),
      dryRun,
      summary: {
        signalCount: signals.length,
        entered: 0,
        exited: tradesExited.length,
      },
      signalsFired: signals.map((s) => {
        const pos = calculatePositionSize(s, accountBalance, equityCurveState);
        return {
          ticker: s.ticker,
          currency: getCurrencySymbol(s.ticker),
          date: s.date,
          close: s.close,
          volume: s.volume,
          avgVolume20: s.avgVolume20,
          volumeRatio: s.volumeRatio,
          rangePosition: s.rangePosition,
          atr20: s.atr20,
          suggestedEntry: s.suggestedEntry,
          hardStop: s.hardStop,
          riskPerShare: s.riskPerShare,
          positionSize: pos
            ? {
                shares: pos.shares,
                totalExposure: pos.totalExposure,
                dollarRisk: pos.dollarRisk,
                exposurePercent: pos.exposurePercent,
                exposureWarning: pos.exposureWarning,
              }
            : null,
          regimeAssessment: s.regimeAssessment
            ? {
                overallSignal: s.regimeAssessment.overallSignal,
                warnings: s.regimeAssessment.warnings,
                score: s.regimeAssessment.score,
                regime: {
                  marketRegime: s.regimeAssessment.regime.marketRegime,
                  qqqClose: s.regimeAssessment.regime.qqqClose,
                  qqq200MA: s.regimeAssessment.regime.qqq200MA,
                  qqqPctAboveMA: s.regimeAssessment.regime.qqqPctAboveMA,
                  volatilityRegime: s.regimeAssessment.regime.volatilityRegime,
                  vixLevel: s.regimeAssessment.regime.vixLevel,
                },
                tickerRegime: s.regimeAssessment.tickerRegime,
              }
            : null,
        };
      }),
      tradesEntered: [],
      tradesExited,
      nearMisses: topNearMisses,
      openPositions: finalOpenCount,
      balance: accountBalance,
      regime: {
        marketRegime: marketRegime.marketRegime,
        qqqClose: marketRegime.qqqClose,
        qqq200MA: marketRegime.qqq200MA,
        qqqPctAboveMA: marketRegime.qqqPctAboveMA,
        volatilityRegime: marketRegime.volatilityRegime,
        vixLevel: marketRegime.vixLevel,
      },
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
    });
  } catch (err) {
    if (scanRunId != null) {
      const durationMs = Date.now() - startTime;
      await prisma.scanRun.update({
        where: { id: scanRunId },
        data: {
          completedAt: new Date(),
          status: "FAILED",
          error: err instanceof Error ? err.message : "Unknown error",
          durationMs,
        },
      });
    }
    console.error("[/api/scan] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 },
    );
  }
}
