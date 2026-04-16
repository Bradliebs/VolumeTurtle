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
import { validateTicker } from "../src/lib/signals/dataValidator";
import type { ValidationResult } from "../src/lib/signals/dataValidator";
import { formatAlertMessage, sendTelegram } from "../src/lib/telegram";
import { isAutoExecutionEnabled, createPendingOrder } from "../src/lib/execution/autoExecutor";
import { calculateBreadth, breadthModifier, breadthSectorMultiplier } from "../src/lib/signals/breadthIndicator";
import type { BreadthResult } from "../src/lib/signals/breadthIndicator";
import { ensureTickerInCsv } from "../src/lib/universe/ensureInCsv";
import { loadT212Settings, getCachedT212Positions } from "../src/lib/t212/client";


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
  liquidTickerCount: number;
  validationBlocked: number;
  validationWarnings: number;
  crossValidated: number;
}

const summary: ScanSummary = {
  signalsFired: [],
  tradesEntered: [],
  tradesExited: [],
  openPositions: [],
  accountBalance: 0,
  liquidTickerCount: 0,
  validationBlocked: 0,
  validationWarnings: 0,
  crossValidated: 0,
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
  // Override: keep position count at config.maxPositions even in CAUTION.
  // Risk-per-trade reduction still applies, but we don't want to block entries
  // when we already hold positions from before the drawdown.
  equityCurveState.maxPositions = config.maxPositions;
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

  // Coverage gate: abort if less than 10% of universe has data
  const coveragePct = universe.length > 0 ? (fetchedTickers.length / universe.length) * 100 : 0;
  if (fetchedTickers.length < 50 || coveragePct < 10) {
    const msg = `Data coverage too low: ${fetchedTickers.length}/${universe.length} tickers (${coveragePct.toFixed(0)}%). Yahoo Finance may be down. Aborting scan.`;
    console.error(`[nightlyScan] ABORT: ${msg}`);
    try { await sendTelegram({ text: `<b>\u26a0 SCAN ABORTED</b>\n${msg}` }); } catch { /* best effort */ }
    process.exit(1);
  }

  // 3. Filter by minimum liquidity
  const liquidTickers = fetchedTickers.filter((ticker) => {
    const quotes = quoteMap[ticker]!;
    return hasMinimumLiquidity(ticker, quotes);
  });
  console.log(`[nightlyScan] ${liquidTickers.length} tickers pass liquidity filter`);
  summary.liquidTickerCount = liquidTickers.length;

  // 3b. Calculate market regime
  console.log(`[nightlyScan] Calculating market regime (QQQ + VIX)…`);
  const marketRegime = await calculateMarketRegime();
  console.log(`[nightlyScan] Market regime: ${marketRegime.marketRegime}`);
  console.log(`[nightlyScan] QQQ: ${marketRegime.qqqClose.toFixed(2)} vs 200MA: ${marketRegime.qqq200MA.toFixed(2)} (${marketRegime.qqqPctAboveMA >= 0 ? "+" : ""}${marketRegime.qqqPctAboveMA.toFixed(1)}%)`);
  console.log(`[nightlyScan] VIX: ${marketRegime.vixLevel?.toFixed(1) ?? "unavailable"} (${marketRegime.volatilityRegime})`);

  // 3c. Calculate market breadth
  console.log(`[nightlyScan] Calculating market breadth…`);
  let breadth: BreadthResult | null = null;
  try {
    breadth = await calculateBreadth(universe);
    if (breadth) {
      console.log(
        `[nightlyScan] Breadth: ${breadth.breadthScore.toFixed(0)} ${breadth.breadthSignal} ` +
        `(${breadth.above50MA.toFixed(0)}% above 50MA, ` +
        `${breadth.newHighs} highs / ${breadth.newLows} lows)`,
      );
      if (breadth.warning) {
        console.log(`[nightlyScan] ⚠ Breadth warning: ${breadth.warning}`);
      }
    } else {
      console.log(`[nightlyScan] Breadth skipped — insufficient price cache`);
    }
  } catch (err) {
    console.error(`[nightlyScan] Breadth calculation failed:`, err);
  }

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

  // 4. Generate signals (with data validation)
  const signals: VolumeSignal[] = [];
  for (const ticker of liquidTickers) {
    const quotes = quoteMap[ticker]!;

    // Data validation gate
    const validation = await validateTicker(ticker, quotes, null);
    if (!validation.valid) {
      summary.validationBlocked++;
      // Send Telegram alert for extreme move blocks (important for held positions)
      for (const flag of validation.flags) {
        if (flag.startsWith("EXTREME_MOVE") || flag.startsWith("SPLIT_SUSPECTED")) {
          try {
            const text = await formatAlertMessage({
              type: "DATA_QUALITY",
              ticker,
              message: flag,
              chgPct: validation.rawMove,
            });
            await sendTelegram({ text });
          } catch { /* best effort */ }
        }
      }
      continue;
    }
    if (validation.warnings.length > 0) summary.validationWarnings++;
    if (validation.crossValidated) summary.crossValidated++;

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

  // Apply breadth modifier to composite scores (adjusts regime component externally)
  if (breadth) {
    const mod = breadthModifier(breadth.breadthSignal);
    if (mod !== 0) {
      for (const signal of signals) {
        if (signal.compositeScore) {
          const adjusted = signal.compositeScore.components.regimeScore + mod;
          const clamped = Math.max(0, Math.min(0.35, adjusted));
          const delta = clamped - signal.compositeScore.components.regimeScore;
          signal.compositeScore.components.regimeScore = clamped;
          signal.compositeScore.total = Math.max(0, signal.compositeScore.total + delta);
          // Re-grade
          if (signal.compositeScore.total >= 0.75) signal.compositeScore.grade = "A";
          else if (signal.compositeScore.total >= 0.55) signal.compositeScore.grade = "B";
          else if (signal.compositeScore.total >= 0.35) signal.compositeScore.grade = "C";
          else signal.compositeScore.grade = "D";
        }
      }
      console.log(`[nightlyScan] Breadth modifier applied: ${mod > 0 ? "+" : ""}${mod.toFixed(2)} (${breadth.breadthSignal})`);
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
  // Load T212 positions to prevent auto-closing trades still held on T212
  let t212Tickers: Set<string> | null = null;
  const t212Settings = loadT212Settings();
  const t212Configured = t212Settings != null;
  if (t212Settings && !DRY_RUN) {
    try {
      const cached = await getCachedT212Positions(t212Settings);
      t212Tickers = new Set(cached.positions.map((p: { ticker: string }) => p.ticker));
    } catch {
      console.log("  [WARN] T212 positions unavailable — will skip auto-close if stop breached");
    }
  }

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
      // T212 safety: don't auto-close if T212 still holds the position
      if (t212Configured && t212Tickers == null) {
        console.log(`  [SKIP] ${trade.ticker} — stop breached but T212 positions unavailable, skipping auto-close`);
        continue;
      }
      if (t212Tickers?.has(trade.ticker)) {
        console.log(`  [SKIP] ${trade.ticker} — stop breached but T212 position still held, skipping auto-close`);
        continue;
      }

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

        // Runner exit metrics
        const runnerData: Record<string, unknown> = {};
        if (trade.isRunner) {
          const exitProfitPct = (currentClose - trade.entryPrice) / trade.entryPrice;
          const captureRate = trade.runnerPeakProfit
            ? exitProfitPct / trade.runnerPeakProfit
            : null;
          runnerData.runnerExitProfit = exitProfitPct;
          runnerData.runnerCaptureRate = captureRate;

          const holdDays = Math.floor(
            (Date.now() - new Date(trade.entryDate).getTime()) / (1000 * 60 * 60 * 24),
          );
          console.log(
            `  [RUNNER EXIT] ${trade.ticker} — Peak: +${((trade.runnerPeakProfit ?? 0) * 100).toFixed(1)}% Exit: ${exitProfitPct >= 0 ? "+" : ""}${(exitProfitPct * 100).toFixed(1)}% Capture: ${captureRate != null ? (captureRate * 100).toFixed(0) : "—"}% Hold: ${holdDays}d`,
          );
        }

        await prisma.trade.update({
          where: { id: trade.id },
          data: {
            status: "CLOSED",
            exitDate: today,
            exitPrice: currentClose,
            exitReason,
            rMultiple,
            ...runnerData,
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

      const position = calculatePositionSize(signal, accountBalance, equityCurveState, marketRegime.volatilityRegime);
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

        // ── Auto-execution check ──────────────────────────────────────
        const grade = signal.compositeScore?.grade;
        const isAutoGrade = grade === "A" || grade === "B";
        let autoExecEnabled = false;
        if (isAutoGrade) {
          try {
            autoExecEnabled = await isAutoExecutionEnabled(grade);
          } catch { /* fallback to manual */ }
        }

        if (autoExecEnabled && isAutoGrade) {
          // Check daily limit BEFORE creating pending order
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayOrders = await prisma.pendingOrder.count({
            where: {
              createdAt: { gte: todayStart },
              status: { in: ["pending", "executed"] },
            },
          });
          const appSettingsForLimit = await prisma.appSettings.findFirst({ orderBy: { id: "asc" } });
          const maxPerDay = (appSettingsForLimit as unknown as { autoExecutionMaxPerDay?: number })?.autoExecutionMaxPerDay ?? 2;
          if (todayOrders >= maxPerDay) {
            console.log(`  [AUTO-EXEC SKIP] Daily limit reached (${todayOrders}/${maxPerDay}) — skipping ${signal.ticker}`);
            // Fall through to standard manual trade entry below
          } else {
          // Create PendingOrder instead of immediate Trade entry
          try {
            // Determine runner eligibility
            let isRunnerCandidate = false;
            try {
              const appSettings2 = await prisma.appSettings.findFirst({ orderBy: { id: "asc" } });
              const runnerEnabled2 = (appSettings2 as unknown as { runnerEnabled?: boolean })?.runnerEnabled ?? true;
              if (runnerEnabled2) {
                const existingRunner2 = await prisma.trade.findFirst({ where: { isRunner: true, status: "OPEN" } });
                if (!existingRunner2) {
                  const score2 = signal.compositeScore?.total ?? 0;
                  isRunnerCandidate = score2 >= 0.55;
                }
              }
            } catch { /* not runner */ }

            // Look up sector from DB ticker table
            let sector = "Unknown";
            try {
              const tickerRow = await prisma.ticker.findFirst({ where: { symbol: signal.ticker } });
              if (tickerRow?.sector) sector = tickerRow.sector;
            } catch { /* use default */ }

            await createPendingOrder({
              ticker: signal.ticker,
              sector,
              signalSource: "volume",
              signalGrade: grade,
              compositeScore: signal.compositeScore?.total ?? 0,
              suggestedShares: position.shares,
              suggestedEntry: signal.suggestedEntry,
              suggestedStop: signal.hardStop,
              dollarRisk: position.dollarRisk,
              isRunner: isRunnerCandidate,
            });
            console.log(`  [AUTO-EXEC] ${signal.ticker} — Grade ${grade} pending order created (${position.shares} shares)`);
          } catch (autoErr) {
            console.error(`  [AUTO-EXEC ERROR] ${signal.ticker} — ${autoErr instanceof Error ? autoErr.message : String(autoErr)}`);
            // Fallback: create trade normally
            await prisma.trade.create({
              data: {
                ticker: signal.ticker,
                entryDate: today,
                entryPrice: signal.suggestedEntry,
                shares: position.shares,
                hardStop: signal.hardStop,
                trailingStop: signal.hardStop,
                status: "OPEN",
                volumeRatio: signal.volumeRatio,
                rangePosition: signal.rangePosition,
                atr20: signal.atr20,
              },
            });
            ensureTickerInCsv(signal.ticker, sector);
          }
          } // end daily limit else
        } else {
          // Standard manual trade entry (original behavior)
          let sector = "Unknown";
          try {
            const tickerRow = await prisma.ticker.findFirst({ where: { symbol: signal.ticker } });
            if (tickerRow?.sector) sector = tickerRow.sector;
          } catch { /* use default */ }
          await prisma.trade.create({
            data: {
              ticker: signal.ticker,
              entryDate: today,
              entryPrice: signal.suggestedEntry,
              shares: position.shares,
              hardStop: signal.hardStop,
              trailingStop: signal.hardStop,
              status: "OPEN",
              volumeRatio: signal.volumeRatio,
              rangePosition: signal.rangePosition,
              atr20: signal.atr20,
            },
          });
          ensureTickerInCsv(signal.ticker, sector);
        }

        // ── Runner designation ────────────────────────────────────────
        try {
          const appSettings = await prisma.appSettings.findFirst({ orderBy: { id: "asc" } });
          const runnerEnabled = (appSettings as unknown as { runnerEnabled?: boolean })?.runnerEnabled ?? true;

          if (runnerEnabled) {
            // Check if runner slot is available
            const existingRunner = await prisma.trade.findFirst({
              where: { isRunner: true, status: "OPEN" },
            });

            if (!existingRunner) {
              // Check convergence: both volume and momentum fired for this ticker today
              const dayStart = new Date(today);
              dayStart.setHours(0, 0, 0, 0);
              const dayEnd = new Date(today);
              dayEnd.setHours(23, 59, 59, 999);

              const [volHit, momHit] = await Promise.all([
                prisma.scanResult.findFirst({
                  where: { ticker: signal.ticker, signalFired: true, scanDate: { gte: dayStart, lte: dayEnd } },
                }),
                prisma.momentumSignal.findFirst({
                  where: { ticker: signal.ticker, createdAt: { gte: dayStart, lte: dayEnd }, status: "active" },
                }),
              ]);

              const isConvergence = volHit != null && momHit != null;
              const score = signal.compositeScore ?? 0;
              const shouldDesignate = isConvergence || score >= 0.55;

              if (shouldDesignate) {
                const newTrade = await prisma.trade.findFirst({
                  where: { ticker: signal.ticker, status: "OPEN" },
                  orderBy: { createdAt: "desc" },
                });
                if (newTrade) {
                  await prisma.trade.update({
                    where: { id: newTrade.id },
                    data: { isRunner: true },
                  });
                  const reason = isConvergence ? "convergence (volume + momentum)" : `Grade ${score >= 0.75 ? "A" : "B"} (${score.toFixed(2)})`;
                  console.log(`  [RUNNER] ${signal.ticker} designated as runner — ${reason}`);
                }
              }
            }
          }
        } catch (err) {
          console.log(`  [WARN] Runner designation failed for ${signal.ticker}: ${err instanceof Error ? err.message : String(err)}`);
        }
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

  // 8. Save AccountSnapshot (with drift + seed guards)
  if (!DRY_RUN) {
    let skipSnapshot = false;

    // Guard 1: reject config seed when real snapshots exist
    if (accountBalance === config.balance) {
      const realCount = await prisma.accountSnapshot.count({ where: { balance: { not: config.balance } } });
      if (realCount > 0) {
        console.warn(`[nightlyScan] Skipping snapshot — balance £${accountBalance} matches config seed but DB has ${realCount} real snapshots`);
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
          console.error(`[nightlyScan] Skipping snapshot — balance £${accountBalance} is ${driftPct.toFixed(0)}% away from last (£${prevBal})`);
          try { await sendTelegram({ text: `<b>⚠ BAD SNAPSHOT BLOCKED</b>\nBalance £${accountBalance} drifted ${driftPct.toFixed(0)}% from £${prevBal}` }); } catch { /* best effort */ }
          skipSnapshot = true;
        }
      }
    }

    if (!skipSnapshot) {
      await prisma.accountSnapshot.create({
        data: {
          date: today,
          balance: accountBalance,
          openTrades: finalOpenTrades,
        },
      });
    }
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
        // Breadth metrics
        breadthScore: breadth?.breadthScore ?? null,
        breadthSignal: breadth?.breadthSignal ?? null,
        breadthTrend: breadth?.breadthTrend ?? null,
        above50MAPct: breadth?.above50MA ?? null,
        above200MAPct: breadth?.above200MA ?? null,
        newHighLowRatio: breadth?.newHighLowRatio ?? null,
        advanceDeclinePct: breadth?.advanceDecline ?? null,
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
      //    with data validation — remove blocked tickers from priceMap
      const priceMap = new Map<string, Candle[]>();
      let mValidationBlocked = 0;
      let mValidationWarnings = 0;
      let mCrossValidated = 0;
      const tickerWarnings = new Map<string, string[]>();
      for (const [ticker, quotes] of Object.entries(mQuoteMap)) {
        const candles = quotes.map((q) => ({
          date: q.date,
          open: q.open,
          high: q.high,
          low: q.low,
          close: q.close,
          volume: q.volume,
        }));
        const validation = await validateTicker(ticker, candles, null);
        if (!validation.valid) {
          mValidationBlocked++;
          for (const flag of validation.flags) {
            if (flag.startsWith("EXTREME_MOVE") || flag.startsWith("SPLIT_SUSPECTED")) {
              try {
                const text = await formatAlertMessage({ type: "DATA_QUALITY", ticker, message: flag, chgPct: validation.rawMove });
                await sendTelegram({ text });
              } catch { /* best effort */ }
            }
          }
          continue;
        }
        if (validation.warnings.length > 0) {
          mValidationWarnings++;
          tickerWarnings.set(ticker, validation.warnings);
        }
        if (validation.crossValidated) mCrossValidated++;
        priceMap.set(ticker, candles);
      }
      console.log(`[momentum] Validated: ${priceMap.size} · Blocked: ${mValidationBlocked} · Warnings: ${mValidationWarnings}`);

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
      const hotSectorCount = breadth ? Math.round(5 * breadthSectorMultiplier(breadth.breadthSignal)) : 5;
      const hotSectors = sectors.slice(0, Math.max(1, hotSectorCount)).map((s) => s.sector);
      const { candidates, nearMisses } = findBreakouts(
        mUniverse, priceMap, hotSectors, sectors,
      );

      // Apply breadth modifier to momentum composite scores
      if (breadth) {
        const mod = breadthModifier(breadth.breadthSignal);
        if (mod !== 0) {
          for (const c of candidates) {
            const adjusted = c.compositeScore.components.regime + mod;
            const clamped = Math.max(0, Math.min(0.35, adjusted));
            const delta = clamped - c.compositeScore.components.regime;
            c.compositeScore.components.regime = clamped;
            c.compositeScore.total = Math.max(0, c.compositeScore.total + delta);
            // Re-grade
            if (c.compositeScore.total >= 0.75) c.compositeScore.grade = "A";
            else if (c.compositeScore.total >= 0.55) c.compositeScore.grade = "B";
            else if (c.compositeScore.total >= 0.35) c.compositeScore.grade = "C";
            else c.compositeScore.grade = "D";
          }
        }
      }
      console.log(`[momentum] Breakouts: ${candidates.length} signals, ${nearMisses.length} near misses`);

      // 7. Save MomentumSignal rows
      const signalRows: any[] = [];
      for (const c of candidates) {
        const w = tickerWarnings.get(c.ticker);
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
          dataWarnings: w ? JSON.stringify(w) : null,
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

      // 7b. Auto-execution for Grade A/B momentum signals
      for (const c of candidates) {
        const grade = c.compositeScore.grade;
        if (grade !== "A" && grade !== "B") continue;
        try {
          const autoEnabled = await isAutoExecutionEnabled(grade);
          if (!autoEnabled) continue;

          // Daily order limit check
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const todayOrders = await (prisma as any).pendingOrder.count({
            where: {
              createdAt: { gte: todayStart },
              status: { in: ["pending", "executed"] },
            },
          });
          const momSettings = await prisma.appSettings.findFirst({ orderBy: { id: "asc" } });
          const maxPerDay = (momSettings as unknown as { autoExecutionMaxPerDay?: number })?.autoExecutionMaxPerDay ?? 2;
          if (todayOrders >= maxPerDay) {
            console.log(`  [AutoExec] Daily limit reached (${todayOrders}/${maxPerDay}) — skipping ${c.ticker}`);
            break;
          }

          // Check for duplicate pending order (not just open trades)
          const existingPending = await (prisma as any).pendingOrder.findFirst({
            where: { ticker: c.ticker, status: "pending" },
          });
          if (existingPending) {
            console.log(`  [AutoExec] Pending order already exists for ${c.ticker} (ID: ${existingPending.id}) — skipping momentum duplicate`);
            continue;
          }

          // Check if already holding this ticker
          const existingOpen = await prisma.trade.findFirst({
            where: { ticker: c.ticker, status: "OPEN" },
          });
          if (existingOpen) {
            console.log(`  [AUTO-EXEC SKIP] ${c.ticker} — already open`);
            continue;
          }

          // Position sizing for momentum signal (estimate)
          const riskPerShare = c.price > 0 ? c.price * 0.02 * config.hardStopAtrMultiple : 1;
          const dollarRisk = accountBalance * (equityCurveState.riskPctPerTrade / 100);
          const shares = riskPerShare > 0 ? Math.floor(dollarRisk / riskPerShare) : 0;
          if (shares <= 0) continue;

          const stopPrice = c.price - riskPerShare;

          // Runner check
          let isRunnerCandidate = false;
          try {
            const existingRunner = await prisma.trade.findFirst({ where: { isRunner: true, status: "OPEN" } });
            if (!existingRunner && c.compositeScore.total >= 0.55) {
              isRunnerCandidate = true;
            }
          } catch { /* not runner */ }

          await createPendingOrder({
            ticker: c.ticker,
            sector: c.sector,
            signalSource: "momentum",
            signalGrade: grade,
            compositeScore: c.compositeScore.total,
            suggestedShares: shares,
            suggestedEntry: c.price,
            suggestedStop: stopPrice,
            dollarRisk,
            isRunner: isRunnerCandidate,
          });
          console.log(`  [AutoExec] Momentum pending order created — ${c.ticker} Grade ${grade}${isRunnerCandidate ? " (RUNNER)" : ""}`);
        } catch (autoErr) {
          console.error(`  [AUTO-EXEC ERROR] ${c.ticker} — ${autoErr instanceof Error ? autoErr.message : String(autoErr)}`);
        }
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
          validationBlocked: mValidationBlocked,
          validationWarnings: mValidationWarnings,
          crossValidated: mCrossValidated,
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
  // DB snapshot is the source of truth — env var is only a seed for first-ever run.
  // Use findMany+take:1 as robust alternative to findFirst (which can
  // silently return null with certain PrismaPg adapter initialisation paths).
  await prisma.$connect();
  const results = await prisma.accountSnapshot.findMany({
    orderBy: { date: "desc" },
    take: 1,
  });
  const latest = results[0];
  if (latest) {
    console.log(`[nightlyScan] Balance from DB snapshot: £${latest.balance} (${latest.date.toISOString().slice(0, 19)})`);
    return latest.balance;
  }

  // No snapshots at all — only safe if there are also no open trades (i.e. first run).
  const openTradeCount = await prisma.trade.count({ where: { status: "OPEN" } });
  if (openTradeCount > 0) {
    const msg = `Cannot determine balance: 0 snapshots in DB but ${openTradeCount} open trades. DB connection may be broken.`;
    console.error(`[nightlyScan] FATAL: ${msg}`);
    try { await sendTelegram({ text: `<b>⚠ SCAN ABORTED</b>\n${msg}` }); } catch { /* best effort */ }
    process.exit(1);
  }

  console.warn(`[nightlyScan] First run — seeding balance from config: £${config.balance}`);
  return config.balance;
}

function printSummary(): void {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  VOLUME TURTLE — NIGHTLY SCAN SUMMARY${DRY_RUN ? " (DRY RUN)" : ""}`);
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Date:             ${todayStr}`);
  console.log(`  Account Balance:  $${summary.accountBalance.toLocaleString()}`);
  console.log("───────────────────────────────────────────────────────");
  console.log(`  Validated:        ${summary.liquidTickerCount} · Blocked: ${summary.validationBlocked} · Warnings: ${summary.validationWarnings} · Cross-validated: ${summary.crossValidated}`);

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
