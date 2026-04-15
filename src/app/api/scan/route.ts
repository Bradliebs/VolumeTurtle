import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { config } from "@/lib/config";
import { getUniverse, hasMinimumLiquidity } from "@/lib/universe/tickers";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { generateSignal, calculateAverageVolume, isVolumeSpike, isPriceConfirmed } from "@/lib/signals/volumeSignal";
import type { VolumeSignal } from "@/lib/signals/volumeSignal";
import { shouldExit, updateTrailingStop } from "@/lib/signals/exitSignal";
import { calculatePositionSize } from "@/lib/risk/positionSizer";
import { getCurrencySymbol } from "@/lib/currency";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/scan");
import { calculateMarketRegime } from "@/lib/signals/regimeFilter";
import { calculateTickerRegime, assessRegime } from "@/lib/signals/regimeFilter";
import { calculateEquityCurveState } from "@/lib/risk/equityCurve";
import { calculateCompositeScore } from "@/lib/signals/compositeScore";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { calculateRMultiple, buildStopHistoryData, tradeToOpenPosition } from "@/lib/trades/utils";
import type { ExitReason } from "@/lib/trades/types";
import { loadT212Settings, getCachedT212Positions } from "@/lib/t212/client";
import { validateTicker } from "@/lib/signals/dataValidator";

async function loadAccountBalance(): Promise<number> {
  const results = await prisma.accountSnapshot.findMany({
    orderBy: { date: "desc" },
    take: 1,
  });
  const latest = results[0];
  if (latest) return latest.balance;

  // No snapshots — only safe on first-ever run (no open trades)
  const openTradeCount = await prisma.trade.count({ where: { status: "OPEN" } });
  if (openTradeCount > 0) {
    throw new Error(`Cannot determine balance: 0 snapshots but ${openTradeCount} open trades`);
  }
  return config.balance;
}

export async function GET(request: NextRequest) {
  // Rate limit: max 5 scans per minute
  const limited = rateLimit(getRateLimitKey(request), 5, 60_000);
  if (limited) return limited;

  const dryRun = request.nextUrl.searchParams.get("dry") === "true";
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
      hasMinimumLiquidity(ticker, quoteMap[ticker]!),
    );

    // 4. Check open positions (needed for actionTaken in signal loop)
    const openTrades = await prisma.trade.findMany({
      where: { status: "OPEN" },
    });
    const openCount = openTrades.length;

    // 5. Generate signals + collect near misses (with data validation)
    const signals: VolumeSignal[] = [];
    const nearMisses: Array<{ ticker: string; volumeRatio: number; rangePosition: number; failedOn: "VOLUME" | "RANGE" | "LIQUIDITY"; potentialScore: number; potentialGrade: string }> = [];
    let validationBlocked = 0;
    let validationWarnings = 0;
    let crossValidatedCount = 0;

    for (const ticker of liquidTickers) {
      const quotes = quoteMap[ticker]!;

      // Data validation gate
      const validation = await validateTicker(ticker, quotes, null);
      if (!validation.valid) {
        validationBlocked++;
        continue;
      }
      if (validation.warnings.length > 0) validationWarnings++;
      if (validation.crossValidated) crossValidatedCount++;

      const signal = generateSignal(ticker, quotes, marketRegime);

      const pos = signal ? calculatePositionSize(signal, accountBalance, equityCurveState) : null;
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
            : openCount >= config.maxPositions
              ? "SKIPPED_MAX_POSITIONS"
              : "SIGNAL_FIRED"
          : "NO_SIGNAL",
        suggestedEntry: signal?.suggestedEntry ?? null,
        hardStop: signal?.hardStop ?? null,
        riskPerShare: signal?.riskPerShare ?? null,
        shares: pos?.shares ?? null,
        totalExposure: pos?.totalExposure ?? null,
        dollarRisk: pos?.dollarRisk ?? null,
        regimeScore: signal?.compositeScore?.components?.regimeScore ?? null,
        trendScore: signal?.compositeScore?.components?.trendScore ?? null,
        volumeCompScore: signal?.compositeScore?.components?.volumeScore ?? null,
        liquidityScore: signal?.compositeScore?.components?.liquidityScore ?? null,
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
            // Calculate potential composite score
            const tickerRegime = calculateTickerRegime(ticker, quotes);
            const regimeAssess = assessRegime(marketRegime, tickerRegime);
            const dollarVolWindow = quotes.slice(-(config.atrPeriod + 1), -1);
            const avgDollarVol = dollarVolWindow.length > 0
              ? dollarVolWindow.reduce((sum, q) => sum + q.close * q.volume, 0) / dollarVolWindow.length
              : 0;
            const potentialScore = calculateCompositeScore(regimeAssess, Math.max(volRatio, 2.0), avgDollarVol);

            nearMisses.push({
              ticker,
              volumeRatio: volRatio,
              rangePosition: rangePos,
              failedOn: !spiked ? "VOLUME" : "RANGE",
              potentialScore: potentialScore.total,
              potentialGrade: potentialScore.grade,
            });
          }
        }
      }
    }

    signals.sort((a, b) => (b.compositeScore?.total ?? 0) - (a.compositeScore?.total ?? 0));

    // 6. Process exits
    // Load T212 positions to avoid auto-closing trades still held on T212
    let t212Tickers: Set<string> | null = null;
    const t212Settings = loadT212Settings();
    const t212Configured = t212Settings != null;
    if (t212Settings) {
      try {
        const cached = await getCachedT212Positions(t212Settings);
        t212Tickers = new Set(cached.positions.map((p) => p.ticker));
      } catch {
        // T212 fetch failed — proceed without guard
      }
    }

    const tradesExited: Array<{ ticker: string; exitPrice: number; exitReason: ExitReason; rMultiple: number }> = [];
    for (const trade of openTrades) {
      const quotes = quoteMap[trade.ticker];
      if (!quotes || quotes.length === 0) continue;

      const latestQuote = quotes[quotes.length - 1]!;
      const currentClose = latestQuote.close;

      const stopBreached = currentClose < trade.hardStop;
      const trailingBreached = !stopBreached && shouldExit(currentClose, quotes);

      if (stopBreached || trailingBreached) {
        if (t212Configured && t212Tickers == null) {
          log.warn(
            { ticker: trade.ticker, close: currentClose, stop: stopBreached ? trade.hardStop : trade.trailingStop },
            "Stop breached but T212 holdings unavailable — skipping auto-close",
          );
          continue;
        }

        // If T212 says position is still held, skip auto-close
        if (t212Tickers?.has(trade.ticker)) {
          log.warn(
            { ticker: trade.ticker, close: currentClose, stop: stopBreached ? trade.hardStop : trade.trailingStop },
            "Stop breached but T212 position still held — skipping auto-close",
          );
          continue;
        }

        const exitReason: ExitReason = stopBreached ? "HARD_STOP" : "TRAILING_STOP";
        const rMultiple = calculateRMultiple(currentClose, trade.entryPrice, trade.hardStop);
        tradesExited.push({ ticker: trade.ticker, exitPrice: currentClose, exitReason, rMultiple });
        if (!dryRun) {
          await prisma.trade.update({
            where: { id: trade.id },
            data: { status: "CLOSED", exitDate: today, exitPrice: currentClose, exitReason, rMultiple },
          });
        }
        continue;
      }

      const openPos = tradeToOpenPosition(trade);
      const newTrailingStop = updateTrailingStop(openPos, quotes);
      if (newTrailingStop !== trade.trailingStop && !dryRun) {
        await prisma.trade.update({
          where: { id: trade.id },
          data: { trailingStop: newTrailingStop, trailingStopPrice: newTrailingStop },
        });
      }

      // Write stop history record
      const stopChanged = newTrailingStop > trade.trailingStop;
      if (stopChanged && !dryRun) {
        await prisma.stopHistory.create({
          data: buildStopHistoryData(trade.id, today, trade.hardStop, trade.trailingStop, newTrailingStop),
        });
      }
    }

    // 7. Save snapshot + finalize scan in a transaction for consistency
    const finalOpenCount = openCount - tradesExited.length;
    if (!dryRun) {
      // Snapshot guards
      let skipSnapshot = false;

      // Guard 1: reject config seed when real snapshots exist
      if (accountBalance === config.balance) {
        const realCount = await prisma.accountSnapshot.count({ where: { balance: { not: config.balance } } });
        if (realCount > 0) {
          log.warn({ balance: accountBalance, realCount }, "Skipping snapshot — balance matches config seed");
          skipSnapshot = true;
        }
      }

      // Guard 2: reject balance that drifted >50% from last snapshot
      if (!skipSnapshot) {
        const prev = await prisma.accountSnapshot.findMany({ orderBy: { date: "desc" }, take: 1 });
        const prevBal = prev[0]?.balance;
        if (prevBal && prevBal > 0) {
          const driftPct = Math.abs(accountBalance - prevBal) / prevBal * 100;
          if (driftPct > 50) {
            log.error({ balance: accountBalance, prevBal, driftPct }, "Skipping snapshot — balance drift exceeds 50%");
            skipSnapshot = true;
          }
        }
      }

      await prisma.$transaction(async (tx) => {
        if (!skipSnapshot) {
          await tx.accountSnapshot.create({
            data: { date: today, balance: accountBalance, openTrades: finalOpenCount },
          });
        }

        if (scanRunId != null) {
          const durationMs = Date.now() - startTime;
          await tx.scanRun.update({
            where: { id: scanRunId },
            data: {
              completedAt: new Date(),
              tickersScanned: liquidTickers.length,
              signalsFound: signals.length,
              status: "COMPLETED",
              durationMs,
              marketRegime: marketRegime.marketRegime,
              vixLevel: marketRegime.vixLevel != null ? String(marketRegime.vixLevel) : null,
              vixValue: marketRegime.vixLevel,
              qqqVs200MA: marketRegime.qqqPctAboveMA,
              validationBlocked,
              validationWarnings,
              crossValidated: crossValidatedCount,
            },
          });
        }
      });
    }

    // Sort near misses by volumeRatio desc, cap at 5
    nearMisses.sort((a, b) => b.volumeRatio - a.volumeRatio);
    const topNearMisses = nearMisses.slice(0, 5);

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
          compositeScore: s.compositeScore,
          avgDollarVolume20: s.avgDollarVolume20,
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
    log.error({ err }, "Scan failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scan failed" },
      { status: 500 },
    );
  }
}
