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
import { calculatePositionSize } from "@/lib/risk/positionSizer";

const log = createLogger("api/scan/scheduled");
import { calculateEquityCurveState } from "@/lib/risk/equityCurve";
import { calculateRMultiple, buildStopHistoryData, tradeToOpenPosition } from "@/lib/trades/utils";
import type { ExitReason } from "@/lib/trades/types";
import { loadT212Settings, getCachedT212Positions } from "@/lib/t212/client";
import { sendTelegram, formatAlertMessage } from "@/lib/telegram";
import { UK_BANK_HOLIDAYS, US_HOLIDAYS } from "@/lib/cruise-control/market-hours";
import { validateTicker } from "@/lib/signals/dataValidator";

const SCHEDULED_SCAN_TOKEN = process.env.SCHEDULED_SCAN_TOKEN;

async function loadAccountBalance(): Promise<number> {
  const latest = await prisma.accountSnapshot.findFirst({
    orderBy: { date: "desc" },
  });
  if (latest) return latest.balance;
  return config.balance;
}

/** Constant-time string comparison to prevent timing attacks. */
function safeTokenEquals(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length !== b.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return mismatch === 0;
}

export async function GET(req: NextRequest) {
  // Validate secret token (prefer Authorization header, fall back to query param)
  const authHeader = req.headers.get("authorization");
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const queryToken = req.nextUrl.searchParams.get("token");
  const token = headerToken ?? queryToken;
  if (!SCHEDULED_SCAN_TOKEN || !token || !safeTokenEquals(token, SCHEDULED_SCAN_TOKEN)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const marketParam = req.nextUrl.searchParams.get("market") as MarketFilter | null;
  const market: MarketFilter = marketParam === "LSE" || marketParam === "US" || marketParam === "EU" ? marketParam : "ALL";
  const startTime = Date.now();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // Holiday check — skip scan and notify if target market is closed
  const marketClosed =
    (market === "LSE" && UK_BANK_HOLIDAYS.has(todayStr)) ||
    (market === "US" && US_HOLIDAYS.has(todayStr));

  if (marketClosed) {
    try {
      await sendTelegram({
        text: `<b>SCAN SKIPPED — ${market}</b>\nMarket closed (holiday) on ${todayStr}`,
      });
    } catch { /* best effort */ }
    return NextResponse.json({ success: true, market, skipped: true, reason: "market_holiday" });
  }

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

    // 4. Generate signals (with data validation)
    const signals: VolumeSignal[] = [];
    const openCountForAction = await prisma.trade.count({ where: { status: "OPEN" } });
    let validationBlocked = 0;
    let validationWarnings = 0;
    let crossValidatedCount = 0;

    for (const ticker of liquidTickers) {
      const quotes = quoteMap[ticker]!;

      // Data validation gate
      const validation = await validateTicker(ticker, quotes, null);
      if (!validation.valid) {
        validationBlocked++;
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
            : openCountForAction >= config.maxPositions
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
    const marketOpenTrades = openTrades.filter((t) =>
      filterUniverseByMarket([t.ticker], market).length > 0,
    );

    for (const trade of marketOpenTrades) {
      const quotes = quoteMap[trade.ticker];
      if (!quotes || quotes.length === 0) continue;

      const latestQuote = quotes[quotes.length - 1]!;
      const currentClose = latestQuote.close;

      if (currentClose < trade.hardStop) {
        if (t212Configured && t212Tickers == null) {
          log.warn(
            { ticker: trade.ticker, close: currentClose, stop: trade.hardStop },
            "Hard stop breached but T212 holdings unavailable — skipping auto-close",
          );
          continue;
        }

        if (t212Tickers?.has(trade.ticker)) {
          log.warn(
            { ticker: trade.ticker, close: currentClose, stop: trade.hardStop },
            "Hard stop breached but T212 position still held — skipping auto-close",
          );
          continue;
        }
        const rMultiple = calculateRMultiple(currentClose, trade.entryPrice, trade.hardStop);
        tradesExited.push({ ticker: trade.ticker, exitPrice: currentClose, exitReason: "HARD_STOP", rMultiple });
        await prisma.trade.update({
          where: { id: trade.id },
          data: { status: "CLOSED", exitDate: today, exitPrice: currentClose, exitReason: "HARD_STOP", rMultiple },
        });
        continue;
      }

      if (shouldExit(currentClose, quotes)) {
        if (t212Configured && t212Tickers == null) {
          log.warn(
            { ticker: trade.ticker, close: currentClose, stop: trade.trailingStop },
            "Trailing stop breached but T212 holdings unavailable — skipping auto-close",
          );
          continue;
        }

        if (t212Tickers?.has(trade.ticker)) {
          log.warn(
            { ticker: trade.ticker, close: currentClose, stop: trade.trailingStop },
            "Trailing stop breached but T212 position still held — skipping auto-close",
          );
          continue;
        }
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
          data: { trailingStop: newTrailingStop, trailingStopPrice: newTrailingStop },
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
        vixLevel: marketRegime.vixLevel != null ? String(marketRegime.vixLevel) : null,
        vixValue: marketRegime.vixLevel,
        qqqVs200MA: marketRegime.qqqPctAboveMA,
        validationBlocked,
        validationWarnings,
        crossValidated: crossValidatedCount,
      },
    });

    // 9. Send Telegram summary
    try {
      const lines = [
        `<b>SCAN COMPLETE — ${market}</b>`,
        ``,
        `Tickers: ${liquidTickers.length} | Signals: ${signals.length}`,
        `Exits: ${tradesExited.length} | Open: ${finalOpenCount}`,
        `Regime: ${marketRegime.marketRegime} | State: ${equityCurveState.systemState}`,
        `Validated: ${liquidTickers.length} · Blocked: ${validationBlocked} · Warnings: ${validationWarnings}`,
      ];

      if (signals.length > 0) {
        lines.push("", "<b>Signals:</b>");
        for (const s of signals.slice(0, 5)) {
          lines.push(`  <code>${s.ticker}</code> vol ${s.volumeRatio.toFixed(1)}x range ${(s.rangePosition * 100).toFixed(0)}%`);
        }
        if (signals.length > 5) lines.push(`  … +${signals.length - 5} more`);
      }

      if (tradesExited.length > 0) {
        lines.push("", "<b>Exits:</b>");
        for (const t of tradesExited) {
          lines.push(`  <code>${t.ticker}</code> ${t.exitReason} R: ${t.rMultiple >= 0 ? "+" : ""}${t.rMultiple.toFixed(2)}`);
        }
      }

      lines.push("", `Duration: ${(durationMs / 1000).toFixed(1)}s`);

      await sendTelegram({ text: lines.join("\n") });
    } catch (teleErr) {
      log.warn({ err: teleErr }, "Telegram summary failed (scan succeeded)");
    }

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
    try {
      await sendTelegram({
        text: `<b>SCAN FAILED — ${market}</b>\n${err instanceof Error ? err.message : "Unknown error"}`,
      });
    } catch { /* best effort */ }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scheduled scan failed" },
      { status: 500 },
    );
  }
}
