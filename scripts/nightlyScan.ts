/**
 * Nightly scan — the heart of VolumeTurtle.
 * Fully mechanical: scan universe, detect volume spikes, size positions,
 * manage exits via trailing stops. No human judgment.
 *
 * Usage:
 *   npx tsx scripts/nightlyScan.ts
 *   npx tsx scripts/nightlyScan.ts --dry-run
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getUniverse, hasMinimumLiquidity } from "../src/lib/universe/tickers";
import { fetchEODQuotes } from "../src/lib/data/fetchQuotes";
import type { DailyQuote } from "../src/lib/data/fetchQuotes";
import { generateSignal, calculateAverageVolume, isVolumeSpike, isPriceConfirmed } from "../src/lib/signals/volumeSignal";
import type { VolumeSignal } from "../src/lib/signals/volumeSignal";
import { shouldExit, updateTrailingStop } from "../src/lib/signals/exitSignal";
import type { OpenPosition } from "../src/lib/signals/exitSignal";
import { calculateATR } from "../src/lib/risk/atr";
import { calculatePositionSize, checkMaxPositions } from "../src/lib/risk/positionSizer";
import type { PositionSize } from "../src/lib/risk/positionSizer";
import { config } from "../src/lib/config";
import { calculateMarketRegime } from "../src/lib/signals/regimeFilter";
import type { RegimeState } from "../src/lib/signals/regimeFilter";
import { calculateEquityCurveState } from "../src/lib/risk/equityCurve";
import type { EquityCurveState } from "../src/lib/risk/equityCurve";
import { calculateRMultiple, buildStopHistoryData, tradeToOpenPosition } from "../src/lib/trades/utils";
import { loadUniverse } from "../src/lib/hbme/loadUniverse";
import { scoreSectors } from "../src/lib/hbme/sectorEngine";
import { findBreakouts } from "../src/lib/hbme/breakoutEngine";
import { runAlertCheck } from "../src/lib/hbme/alertEngine";
import type { Candle } from "../src/lib/hbme/types";
import { isTradingDay } from "../src/lib/cruise-control/market-hours";


// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

const today = new Date();
const todayStr = today.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Summary accumulators
// ---------------------------------------------------------------------------

interface ScanSummary {
  signalsFired: { ticker: string; volumeRatio: number; rangePosition: number }[];
  tradesEntered: PositionSize[];
  tradesExited: { ticker: string; rMultiple: number }[];
  openPositions: string[];
  accountBalance: number;
}

const summary: ScanSummary = {
  signalsFired: [],
  tradesEntered: [],
  tradesExited: [],
  openPositions: [],
  accountBalance: 0,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Guard: skip non-trading days (weekends + holidays)
  if (!FORCE && !isTradingDay(today)) {
    console.log(`[nightlyScan] ${todayStr} — not a trading day, skipping (use --force to override)`);
    process.exit(0);
  }

  console.log(`[nightlyScan] ${todayStr} — starting${DRY_RUN ? " (DRY RUN)" : ""}…`);

  // 1. Load account balance
  const accountBalance = await loadAccountBalance();
  summary.accountBalance = accountBalance;
  console.log(`[nightlyScan] Account balance: $${accountBalance.toLocaleString()}`);

  // 1a. Calculate equity curve state
  const allSnapshots = await prisma.accountSnapshot.findMany({ orderBy: { date: "asc" } });
  const equityCurveState = calculateEquityCurveState(allSnapshots, config.riskPctPerTrade * 100, config.maxPositions);
  console.log(`[nightlyScan] System state: ${equityCurveState.systemState}`);
  console.log(`[nightlyScan] Risk per trade: ${equityCurveState.riskPctPerTrade}%`);
  console.log(`[nightlyScan] Max positions: ${equityCurveState.maxPositions}`);
  console.log(`[nightlyScan] Reason: ${equityCurveState.reason}`);

  // 2. Fetch EOD quotes for universe
  const universe = getUniverse();
  console.log(`[nightlyScan] Fetching quotes for ${universe.length} tickers…`);
  const quoteMap = await fetchEODQuotes(universe);
  const fetchedTickers = Object.keys(quoteMap);
  console.log(`[nightlyScan] Received data for ${fetchedTickers.length} tickers`);

  // 3. Filter by minimum liquidity
  const liquidTickers = fetchedTickers.filter((ticker) => {
    const quotes = quoteMap[ticker]!;
    return hasMinimumLiquidity(ticker, quotes);
  });
  console.log(`[nightlyScan] ${liquidTickers.length} tickers pass liquidity filter`);

  // 3b. Calculate market regime
  console.log(`[nightlyScan] Calculating market regime (QQQ + VIX)…`);
  const marketRegime = await calculateMarketRegime();
  console.log(`[nightlyScan] Market regime: ${marketRegime.marketRegime}`);
  console.log(`[nightlyScan] QQQ: ${marketRegime.qqqClose.toFixed(2)} vs 200MA: ${marketRegime.qqq200MA.toFixed(2)} (${marketRegime.qqqPctAboveMA >= 0 ? "+" : ""}${marketRegime.qqqPctAboveMA.toFixed(1)}%)`);
  console.log(`[nightlyScan] VIX: ${marketRegime.vixLevel?.toFixed(1) ?? "unavailable"} (${marketRegime.volatilityRegime})`);

  // Debug logging (dry-run only)
  if (DRY_RUN) {
    console.log(`\n[DEBUG] ── Data Fetch Summary ──`);
    console.log(`  Tickers attempted:       ${universe.length}`);
    console.log(`  Valid data (>= 25 days): ${fetchedTickers.length}`);
    console.log(`  Passed liquidity filter: ${liquidTickers.length}`);
    const preview = liquidTickers.slice(0, 5);
    for (const ticker of preview) {
      const quotes = quoteMap[ticker]!;
      const last = quotes[quotes.length - 1]!;
      const avgVol = calculateAverageVolume(quotes, 20);
      const volRatio = avgVol > 0 ? last.volume / avgVol : 0;
      const rangePos = last.high !== last.low
        ? (last.close - last.low) / (last.high - last.low)
        : 0;
      console.log(`  ${ticker.padEnd(6)} | vol ${last.volume.toLocaleString().padStart(14)} | avg20 ${Math.round(avgVol).toLocaleString().padStart(14)} | ratio ${volRatio.toFixed(2).padStart(6)} | close ${last.close.toFixed(2).padStart(8)} | H ${last.high.toFixed(2).padStart(8)} | L ${last.low.toFixed(2).padStart(8)} | range ${(rangePos * 100).toFixed(1).padStart(5)}%`);
    }
    console.log("");
  }

  // 4. Generate signals
  const signals: VolumeSignal[] = [];
  for (const ticker of liquidTickers) {
    const quotes = quoteMap[ticker]!;
    const signal = generateSignal(ticker, quotes, marketRegime);

    // Record scan result for every ticker
    const scanResult = {
      scanDate: today,
      ticker,
      signalFired: signal !== null,
      volumeRatio: signal?.volumeRatio ?? null,
      rangePosition: signal?.rangePosition ?? null,
      atr20: signal?.atr20 ?? null,
      actionTaken: signal ? null : "NO_SIGNAL", // updated below if signal fires
    };
    if (!DRY_RUN) {
      await prisma.scanResult.upsert({
        where: { ticker_scanDate: { ticker, scanDate: today } },
        create: scanResult,
        update: scanResult,
      });
    }

    if (signal) {
      signals.push(signal);
      summary.signalsFired.push({
        ticker: signal.ticker,
        volumeRatio: signal.volumeRatio,
        rangePosition: signal.rangePosition,
      });
    }
  }

  // Sort by volumeRatio descending — strongest spike first
  signals.sort((a, b) => (b.compositeScore?.total ?? 0) - (a.compositeScore?.total ?? 0));
  console.log(`[nightlyScan] ${signals.length} signals fired`);

  // Debug logging (dry-run only)
  if (DRY_RUN) {
    let volSpikeCount = 0;
    let rangePosCount = 0;
    let bothCount = 0;
    for (const ticker of liquidTickers) {
      const quotes = quoteMap[ticker]!;
      const last = quotes[quotes.length - 1]!;
      const spiked = isVolumeSpike(quotes);
      const confirmed = isPriceConfirmed(last);
      if (spiked) volSpikeCount++;
      if (confirmed) rangePosCount++;
      if (spiked && confirmed) bothCount++;
    }
    console.log(`\n[DEBUG] ── Signal Evaluation Summary ──`);
    console.log(`  Tickers evaluated:      ${liquidTickers.length}`);
    console.log(`  volumeRatio >= 2x:      ${volSpikeCount}`);
    console.log(`  rangePosition >= 0.75:  ${rangePosCount}`);
    console.log(`  BOTH conditions met:    ${bothCount}`);
    console.log("");
  }

  // 5. Check open positions
  const openTrades = await prisma.trade.findMany({
    where: { status: "OPEN" },
  });
  let openCount = openTrades.length;

  // 6. Process exits for open trades FIRST (before entries)
  console.log(`[nightlyScan] Checking ${openTrades.length} open trades for exits…`);
  for (const trade of openTrades) {
    const quotes = quoteMap[trade.ticker];
    if (!quotes || quotes.length === 0) {
      console.log(`  [WARN] No quote data for open trade ${trade.ticker} — skipping exit check`);
      continue;
    }

    const latestQuote = quotes[quotes.length - 1]!;
    const currentClose = latestQuote.close;

    // Calculate ATR for R-ladder + ATR trailing
    const atr20 = calculateATR(quotes, 20) ?? trade.atr20;

    // Calculate new monotonic stop (R-ladder + ATR trailing)
    const openPos = tradeToOpenPosition(trade);
    const newTrailingStop = updateTrailingStop(openPos, quotes, atr20);
    const newCurrentStop = Math.max(trade.hardStop, newTrailingStop);

    // Check exit against the monotonic stop level
    if (currentClose < newCurrentStop) {
      const exitReason = currentClose < trade.hardStop ? "HARD_STOP" : "TRAILING_STOP";
      const rMultiple = calculateRMultiple(currentClose, trade.entryPrice, trade.hardStop);

      summary.tradesExited.push({ ticker: trade.ticker, rMultiple });

      if (!DRY_RUN) {
        // Update trailing stop before closing (so final state is accurate)
        if (newTrailingStop > trade.trailingStop) {
          await prisma.trade.update({
            where: { id: trade.id },
            data: { trailingStop: newTrailingStop, trailingStopPrice: newTrailingStop, atr20 },
          });
        }
        await prisma.trade.update({
          where: { id: trade.id },
          data: {
            status: "CLOSED",
            exitDate: today,
            exitPrice: currentClose,
            exitReason,
            rMultiple,
          },
        });
      }

      openCount--;
      console.log(
        `  [EXIT] ${trade.ticker} — ${exitReason} @ $${currentClose.toFixed(2)} (R: ${rMultiple.toFixed(2)})`,
      );
      continue;
    }

    // No exit — update trailing stop (monotonic: only write if it moved up)
    const stopChanged = newTrailingStop > trade.trailingStop;
    if (stopChanged && !DRY_RUN) {
      await prisma.trade.update({
        where: { id: trade.id },
        data: { trailingStop: newTrailingStop, trailingStopPrice: newTrailingStop, atr20 },
      });

      await prisma.stopHistory.create({
        data: buildStopHistoryData(trade.id, today, trade.hardStop, trade.trailingStop, newTrailingStop),
      });
    } else if (!DRY_RUN) {
      // Still update ATR even if stop didn't change
      await prisma.trade.update({
        where: { id: trade.id },
        data: { atr20 },
      });
    }

    if (stopChanged) {
      console.log(
        `  [STOP] ${trade.ticker} — trailing stop raised to $${newTrailingStop.toFixed(2)}`,
      );
    }
  }

  // 6b. Filter out signals for tickers that still have open trades (prevents duplicates)
  const exitedTickers = new Set(summary.tradesExited.map((e) => e.ticker));
  const stillOpenTickers = new Set(
    openTrades.map((t) => t.ticker).filter((t) => !exitedTickers.has(t)),
  );
  const preFilterCount = signals.length;
  for (let i = signals.length - 1; i >= 0; i--) {
    const sig = signals[i]!;
    if (stillOpenTickers.has(sig.ticker)) {
      console.log(`  [SKIP] ${sig.ticker} — already has an open trade`);
      if (!DRY_RUN) {
        await prisma.scanResult.updateMany({
          where: { scanDate: today, ticker: sig.ticker },
          data: { actionTaken: "SKIPPED_ALREADY_OPEN" },
        });
      }
      signals.splice(i, 1);
    }
  }
  if (signals.length < preFilterCount) {
    console.log(`[nightlyScan] Filtered ${preFilterCount - signals.length} signals for tickers with open trades`);
  }

  // 7. Enter new trades (after exits — openCount is now accurate)
  if (!checkMaxPositions(openCount, equityCurveState.maxPositions)) {
    console.log(`[nightlyScan] MAX POSITIONS REACHED (${equityCurveState.maxPositions} allowed in ${equityCurveState.systemState} state) — no new entries today`);
    // Mark all fired signals as skipped
    if (!DRY_RUN) {
      for (const signal of signals) {
        await prisma.scanResult.updateMany({
          where: { scanDate: today, ticker: signal.ticker },
          data: { actionTaken: "SKIPPED_MAX_POSITIONS" },
        });
      }
    }
  } else {
    for (const signal of signals) {
      if (!checkMaxPositions(openCount, equityCurveState.maxPositions)) break;

      const position = calculatePositionSize(signal, accountBalance, equityCurveState);
      if (!position) {
        console.log(`  [SKIP] ${signal.ticker} — position too small`);
        continue;
      }

      summary.tradesEntered.push(position);

      if (!DRY_RUN) {
        // Safety net: re-check DB for existing open trade (race condition guard)
        const existingOpen = await prisma.trade.findFirst({
          where: { ticker: signal.ticker, status: "OPEN" },
        });
        if (existingOpen) {
          console.log(`  [SKIP] ${signal.ticker} — duplicate open trade detected (race condition guard)`);
          await prisma.scanResult.updateMany({
            where: { scanDate: today, ticker: signal.ticker },
            data: { actionTaken: "SKIPPED_ALREADY_OPEN" },
          });
          continue;
        }

        await prisma.scanResult.updateMany({
          where: { scanDate: today, ticker: signal.ticker },
          data: { actionTaken: "ENTERED" },
        });

        await prisma.trade.create({
          data: {
            ticker: signal.ticker,
            entryDate: today,
            entryPrice: signal.suggestedEntry,
            shares: position.shares,
            hardStop: signal.hardStop,
            trailingStop: signal.hardStop, // initial trailing stop = hard stop
            status: "OPEN",
            volumeRatio: signal.volumeRatio,
            rangePosition: signal.rangePosition,
            atr20: signal.atr20,
          },
        });
      }

      openCount++;
      console.log(
        `  [ENTER] ${signal.ticker} — ${position.shares} shares @ $${signal.suggestedEntry.toFixed(2)}, stop $${signal.hardStop.toFixed(2)}`,
      );
    }
  }

  // Recount open trades after exits and entries
  const finalOpenTrades = DRY_RUN
    ? openTrades.length - summary.tradesExited.length + summary.tradesEntered.length
    : await prisma.trade.count({ where: { status: "OPEN" } });
  summary.openPositions = DRY_RUN
    ? openTrades
        .filter((t) => !summary.tradesExited.some((e) => e.ticker === t.ticker))
        .map((t) => t.ticker)
        .concat(summary.tradesEntered.map((e) => e.ticker))
    : (await prisma.trade.findMany({ where: { status: "OPEN" }, select: { ticker: true } }))
        .map((t) => t.ticker);

  // 8. Save AccountSnapshot
  if (!DRY_RUN) {
    await prisma.accountSnapshot.create({
      data: {
        date: today,
        balance: accountBalance,
        openTrades: finalOpenTrades,
      },
    });
  }

  // ── MOMENTUM SCAN ──────────────────────────────────────────────
  if (config.MOMENTUM_ENABLED && !DRY_RUN) {
    console.log("\n── MOMENTUM SCAN ──");

    // Create a ScanRun for momentum (reuse marketRegime from above)
    const momentumScanRun = await prisma.scanRun.create({
      data: {
        startedAt: today,
        status: "RUNNING",
        trigger: "SCHEDULED",
        market: "ALL",
        scanType: "momentum",
        marketRegime: marketRegime.marketRegime,
      },
    });

    try {
      // 1. Load momentum universe
      const mUniverse = await loadUniverse();
      console.log(`[momentum] Universe: ${mUniverse.length} tickers`);

      // 2. Fetch prices (shares PriceCache — no duplicate Yahoo calls)
      const mTickers = mUniverse.map((u) => u.ticker);
      const mQuoteMap = await fetchEODQuotes(mTickers);

      // 3. Convert to Map<string, Candle[]> for sector/breakout engines
      const priceMap = new Map<string, Candle[]>();
      for (const [ticker, quotes] of Object.entries(mQuoteMap)) {
        priceMap.set(ticker, quotes.map((q) => ({
          date: q.date,
          open: q.open,
          high: q.high,
          low: q.low,
          close: q.close,
          volume: q.volume,
        })));
      }

      // 4. Run sector engine
      const sectors = scoreSectors(mUniverse, priceMap);
      console.log(`[momentum] Sectors: ${sectors.length} ranked`);

      // 5. Save SectorScanResult rows
      const sectorData = sectors.map((s, i) => ({
        runAt: today,
        sector: s.sector,
        score: s.score,
        R5: s.R5,
        R20: s.R20,
        volRatio: s.volRatio,
        R5Rank: i + 1,
        R20Rank: i + 1,
        volRank: i + 1,
        scanRunId: momentumScanRun.id,
      }));
      if (sectorData.length > 0) {
        await (prisma as any).sectorScanResult.createMany({ data: sectorData });
      }

      // 6. Run breakout engine on top 5 sectors
      const hotSectors = sectors.slice(0, 5).map((s) => s.sector);
      const { candidates, nearMisses } = findBreakouts(
        mUniverse, priceMap, hotSectors, sectors,
      );
      console.log(`[momentum] Breakouts: ${candidates.length} signals, ${nearMisses.length} near misses`);

      // 7. Save MomentumSignal rows
      const signalRows: any[] = [];
      for (const c of candidates) {
        signalRows.push({
          createdAt: today,
          ticker: c.ticker,
          sector: c.sector,
          chg1d: c.chg1d,
          volRatio: c.volRatio,
          R5: c.R5,
          R20: c.R20,
          price: c.price,
          sma20: 0,
          atr: 0,
          stopPrice: 0,
          compositeScore: c.compositeScore.total,
          grade: c.compositeScore.grade,
          regimeScore: c.regimeScore ?? 0,
          tickerTrend: c.tickerTrend ?? "INSUFFICIENT_DATA",
          sectorScore: c.compositeScore.components.sector,
          sectorRank: 0,
          status: "active",
          scanRunId: momentumScanRun.id,
        });
      }
      for (const nm of nearMisses) {
        signalRows.push({
          createdAt: today,
          ticker: nm.ticker,
          sector: nm.sector,
          chg1d: nm.chg1d,
          volRatio: nm.volRatio,
          R5: nm.R5,
          R20: nm.R20,
          price: nm.price,
          sma20: 0,
          atr: 0,
          stopPrice: 0,
          compositeScore: nm.projectedScore.total,
          grade: nm.projectedGrade,
          regimeScore: 0,
          tickerTrend: "INSUFFICIENT_DATA",
          sectorScore: 0,
          sectorRank: 0,
          status: "near-miss",
          scanRunId: momentumScanRun.id,
        });
      }
      if (signalRows.length > 0) {
        await (prisma as any).momentumSignal.createMany({ data: signalRows });
      }

      // 8. Run alert check
      let alertCount = 0;
      try {
        const alerts = await runAlertCheck();
        alertCount = alerts.length;
      } catch (err) {
        console.error("[momentum] Alert check failed:", err);
      }

      const durationMs = Date.now() - momentumScanRun.startedAt.getTime();
      await prisma.scanRun.update({
        where: { id: momentumScanRun.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          tickersScanned: mUniverse.length,
          signalsFound: candidates.length,
          durationMs,
        },
      });

      console.log(`[momentum] Alerts: ${alertCount} fired`);
      console.log(`[momentum] Completed in ${durationMs}ms`);
    } catch (err) {
      console.error("[momentum] Momentum scan failed:", err);
      await prisma.scanRun.update({
        where: { id: momentumScanRun.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: String(err),
        },
      });
    }
  }

  // 9. Print summary
  printSummary();

  // 10. Auto-backup
  if (!DRY_RUN) {
    try {
      const { runBackup } = await import("./backup");
      const backupResult = await runBackup();
      console.log(`✓ Auto-backup: ${backupResult.backupPath}`);
    } catch (err) {
      console.error("⚠ Auto-backup failed (scan completed successfully):", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadAccountBalance(): Promise<number> {
  const envBalance = process.env["VOLUME_TURTLE_BALANCE"];
  if (envBalance) {
    const parsed = parseFloat(envBalance);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  const latest = await prisma.accountSnapshot.findFirst({
    orderBy: { date: "desc" },
  });
  if (latest) return latest.balance;

  return config.balance;
}

function printSummary(): void {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  VOLUME TURTLE — NIGHTLY SCAN SUMMARY${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Date:             ${todayStr}`);
  console.log(`  Account Balance:  $${summary.accountBalance.toLocaleString()}`);
  console.log("───────────────────────────────────────────────────────");

  console.log(`  Signals Fired:    ${summary.signalsFired.length}`);
  for (const s of summary.signalsFired) {
    console.log(
      `    • ${s.ticker.padEnd(6)} vol ${s.volumeRatio.toFixed(1)}x  range ${(s.rangePosition * 100).toFixed(0)}%`,
    );
  }

  console.log(`  Trades Entered:   ${summary.tradesEntered.length}`);
  for (const t of summary.tradesEntered) {
    console.log(
      `    • ${t.ticker.padEnd(6)} ${t.shares} shares @ $${t.suggestedEntry.toFixed(2)}  stop $${t.hardStop.toFixed(2)}  risk $${t.dollarRisk.toFixed(0)}`,
    );
  }

  console.log(`  Trades Exited:    ${summary.tradesExited.length}`);
  for (const t of summary.tradesExited) {
    console.log(
      `    • ${t.ticker.padEnd(6)} R: ${t.rMultiple >= 0 ? "+" : ""}${t.rMultiple.toFixed(2)}`,
    );
  }

  console.log(`  Open Positions:   ${summary.openPositions.length}`);
  if (summary.openPositions.length > 0) {
    console.log(`    ${summary.openPositions.join(", ")}`);
  }

  console.log("═══════════════════════════════════════════════════════\n");
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main()
  .catch((err) => {
    console.error("[nightlyScan] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
