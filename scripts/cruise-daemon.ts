/**
 * Cruise Control Daemon — Standalone Task Scheduler Script
 *
 * Runs outside Next.js, triggered by Windows Task Scheduler.
 * Polls all open positions, calculates ratcheted stops, pushes to T212.
 * Runs a lightweight intraday volume scan and sends Telegram notifications.
 *
 * Usage:
 *   npx tsx scripts/cruise-daemon.ts
 *
 * Exit codes:
 *   0 = success (or outside market hours)
 *   1 = fatal error
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isMarketOpen } from "../src/lib/cruise-control/market-hours";
import {
  calculateRatchetedStop,
  type PositionType,
} from "../src/lib/cruise-control/stop-ratchet";
import {
  getCurrentPrice,
  updateStopOnT212,
  getOpenPositionsFromT212,
} from "../src/lib/cruise-control/cruise-control-t212";
import { calculateATR } from "../src/lib/risk/atr";
import { getCachedQuotes } from "../src/lib/data/quoteCache";
import { sendTelegram } from "../src/lib/telegram";
import { getCurrencySymbol } from "../src/lib/currency";
import { getUniverse } from "../src/lib/universe/tickers";
import { fetchQuote } from "../src/lib/data/yahoo";
import { calculateMarketRegime, calculateTickerRegime, assessRegime } from "../src/lib/signals/regimeFilter";
import type { RegimeState } from "../src/lib/signals/regimeFilter";
import { calculateCompositeScore } from "../src/lib/signals/compositeScore";
import type { CompositeScore } from "../src/lib/signals/compositeScore";
import { calculateAverageVolume } from "../src/lib/signals/volumeSignal";
import type { DailyQuote } from "../src/lib/data/fetchQuotes";

// ── Logging ─────────────────────────────────────────────────────────────────

const logsDir = path.resolve(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const today = new Date().toISOString().slice(0, 10);
const logFile = path.join(logsDir, `cruise-${today}.log`);

function logLine(
  level: "INFO" | "WARN" | "ERROR",
  message: string,
  data?: Record<string, unknown>,
): void {
  const ts = new Date().toISOString();
  const suffix = data ? ` ${JSON.stringify(data)}` : "";
  const line = `[${ts}] [${level}] ${message}${suffix}\n`;
  fs.appendFileSync(logFile, line);
  if (level === "ERROR") {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

// ── Database ────────────────────────────────────────────────────────────────

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  logLine("ERROR", "DATABASE_URL environment variable is not set");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

// ── Telegram Helper ─────────────────────────────────────────────────────────

function fmtTime(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function sym(ticker: string): string {
  return getCurrencySymbol(ticker);
}

function sourceLabel(source: string): string {
  const s = source?.toLowerCase() ?? "";
  if (s === "pead") return "PEAD";
  if (s === "pairs-long" || s === "pairs_long") return "PAIR";
  if (s === "volume") return "VOL";
  if (s === "momentum") return "MOM";
  return "MOM";
}

async function notify(text: string): Promise<void> {
  try {
    await sendTelegram({ text, parseMode: "HTML" });
  } catch (err) {
    logLine("WARN", `Telegram send failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Ratchet Detail Tracking ─────────────────────────────────────────────────

interface RatchetInfo {
  ticker: string;
  oldStop: number;
  newStop: number;
  currentPrice: number;
  atr: number;
  profitPct: number;
  positionType: PositionType;
  t212Ok: boolean;
}

// ── Intraday Signal Tracking ────────────────────────────────────────────────

interface IntradaySignal {
  ticker: string;
  grade: string;
  score: number;
  volRatio: number;
  rangePosition: number;
  regime: string;
  entry: number;
  stop: number;
  risk: number;
  signalSource: string;
}

interface OpenTrade {
  id: string;
  ticker: string;
  entryPrice: number;
  entryDate: Date;
  shares: number;
  hardStop: number;
  trailingStop: number;
  hardStopPrice: number | null;
  trailingStopPrice: number | null;
  signalSource: string;
}

const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<OpenTrade[]>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  cruiseControlRatchetEvent: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  cruiseControlPollLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  cruiseControlState: {
    findFirst: () => Promise<{
      id: number;
      pollCount: number;
      totalRatchets: number;
    } | null>;
    upsert: (args: {
      where: { id: number };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => Promise<unknown>;
  };
};

// ── Position Classification ─────────────────────────────────────────────────

function classifyPosition(trade: OpenTrade): PositionType {
  const source = trade.signalSource?.toLowerCase() ?? "";
  if (source === "pead") return "pead";
  if (source === "pairs-long" || source === "pairs_long") return "pairs-long";
  return "momentum";
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logLine("INFO", "Cruise control daemon starting");

  // ── Market hours guard (--force bypasses) ───────────────────────────────
  const forceRun = process.argv.includes("--force");
  if (!forceRun && !isMarketOpen()) {
    logLine("INFO", "Outside market hours — exiting (use --force to override)");
    return;
  }

  logLine("INFO", `Market ${isMarketOpen() ? "is open" : "closed (--force)"} — beginning poll cycle`);
  const pollStart = new Date();
  let positionsChecked = 0;
  let stopsRatcheted = 0;
  let stopsUnchanged = 0;
  let retryFailures = 0;
  const ratchets: RatchetInfo[] = [];

  // ── Load open positions ─────────────────────────────────────────────────
  const openTrades: OpenTrade[] = await db.trade.findMany({
    where: { status: "OPEN" },
  });

  // ── DAEMON START notification ───────────────────────────────────────────
  await notify(
    `🕐 <b>Cruise Control</b> — ${fmtTime()}\n` +
    `Market: OPEN | Positions checked: ${openTrades.length}`,
  );

  if (openTrades.length === 0) {
    logLine("INFO", "No open positions — poll complete");
    await logPollResult(pollStart, 0, 0, 0, 0);
    await sendSummary([], [], openTrades);
    return;
  }

  logLine("INFO", `Found ${openTrades.length} open position(s)`);

  // ── Fetch T212 current stops for floor rule ─────────────────────────────
  let t212StopMap: Map<string, number>;
  try {
    const t212Positions = await getOpenPositionsFromT212();
    t212StopMap = new Map<string, number>();
    for (const pos of t212Positions) {
      if (pos.stopLoss != null && pos.stopLoss > 0) {
        t212StopMap.set(pos.ticker.toUpperCase(), pos.stopLoss);
      }
    }
  } catch {
    logLine("WARN", "Could not fetch T212 positions — T212 floor rule will be skipped");
    t212StopMap = new Map();
  }

  // ── Process each position ───────────────────────────────────────────────
  const since = new Date();
  since.setDate(since.getDate() - 60);

  for (const trade of openTrades) {
    positionsChecked++;

    const positionType = classifyPosition(trade);

    // Get current price
    const currentPrice = await getCurrentPrice(trade.ticker);
    if (currentPrice == null) {
      logLine("WARN", `${trade.ticker}: could not get price — skipping`, {
        ticker: trade.ticker,
      });
      stopsUnchanged++;
      continue;
    }

    // Calculate ATR(14)
    const candles = await getCachedQuotes(trade.ticker, since);
    if (candles.length < 6) {
      logLine("WARN", `${trade.ticker}: insufficient candle data (${candles.length}) — skipping`, {
        ticker: trade.ticker,
        candles: candles.length,
      });
      stopsUnchanged++;
      continue;
    }

    const atr = calculateATR(candles, 14);
    if (atr == null || atr <= 0) {
      logLine("WARN", `${trade.ticker}: ATR returned null — skipping`, {
        ticker: trade.ticker,
      });
      stopsUnchanged++;
      continue;
    }

    // Current active stop (highest of hard stop / trailing stop)
    const currentStop = Math.max(
      trade.hardStopPrice ?? trade.hardStop,
      trade.trailingStopPrice ?? trade.trailingStop,
    );

    // Days since entry
    const daysSinceEntry = Math.floor(
      (Date.now() - new Date(trade.entryDate).getTime()) / (1000 * 60 * 60 * 24),
    );

    // ── Calculate ratcheted stop ────────────────────────────────────────
    const newStop = calculateRatchetedStop({
      positionType,
      entryPrice: trade.entryPrice,
      currentStop,
      currentPrice,
      atr,
      daysSinceEntry,
    });

    if (newStop == null) {
      stopsUnchanged++;
      continue;
    }

    // ── T212 floor rule: never push below T212's current stop ──────────
    const t212Stop = t212StopMap.get(trade.ticker.toUpperCase()) ?? null;
    if (t212Stop != null && newStop < t212Stop) {
      logLine("INFO", `${trade.ticker}: ratchet ${newStop.toFixed(2)} blocked by T212 floor ${t212Stop.toFixed(2)}`, {
        ticker: trade.ticker,
        newStop,
        t212Floor: t212Stop,
      });
      stopsUnchanged++;
      continue;
    }

    // ── Update DB ─────────────────────────────────────────────────────
    stopsRatcheted++;
    const profitPct =
      ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
    const ratchetPct =
      currentStop > 0 ? ((newStop - currentStop) / currentStop) * 100 : 0;

    await db.trade.update({
      where: { id: trade.id },
      data: {
        trailingStop: newStop,
        trailingStopPrice: newStop,
      },
    });

    logLine("INFO", `${trade.ticker}: stop ratcheted ${currentStop.toFixed(2)} → ${newStop.toFixed(2)} (+${ratchetPct.toFixed(2)}%)`, {
      ticker: trade.ticker,
      positionType,
      oldStop: currentStop,
      newStop,
      ratchetPct: +ratchetPct.toFixed(2),
      currentPrice,
      profitPct: +profitPct.toFixed(2),
      reason: `ATR-based ${positionType} ratchet`,
    });

    // ── Push to T212 ──────────────────────────────────────────────────
    const t212Result = await updateStopOnT212(
      trade.ticker,
      trade.shares,
      currentStop,
      newStop,
    );

    const t212Ok = t212Result.success;
    if (!t212Ok) {
      retryFailures++;
      logLine("ERROR", `${trade.ticker}: T212 stop update FAILED — DB updated, T212 out of sync`, {
        ticker: trade.ticker,
        error: t212Result.error,
      });
    } else {
      logLine("INFO", `${trade.ticker}: T212 stop updated successfully`);
    }

    // ── Record ratchet event ──────────────────────────────────────────
    await db.cruiseControlRatchetEvent.create({
      data: {
        positionType,
        positionId: trade.id,
        ticker: trade.ticker,
        pollTimestamp: pollStart,
        oldStop: currentStop,
        newStop,
        ratchetPct,
        currentPrice,
        profitPct,
        atrUsed: atr,
        t212Updated: t212Ok,
        t212Response: t212Result.t212Response ?? null,
      },
    });

    // ── Track for summary ─────────────────────────────────────────────
    ratchets.push({
      ticker: trade.ticker,
      oldStop: currentStop,
      newStop,
      currentPrice,
      atr,
      profitPct,
      positionType,
      t212Ok,
    });

    // ── Per-ratchet Telegram ──────────────────────────────────────────
    const c = sym(trade.ticker);
    const profitTier = profitPct >= 50 ? "+50%"
      : profitPct >= 30 ? "+30%"
      : profitPct >= 20 ? "+20%"
      : profitPct >= 10 ? "+10%"
      : profitPct >= 5 ? "+5%"
      : "initial";

    await notify(
      `📈 <b>Stop Ratcheted — ${trade.ticker}</b>\n` +
      `Old stop: ${c}${currentStop.toFixed(2)} → New stop: ${c}${newStop.toFixed(2)}\n` +
      `Current price: ${c}${currentPrice.toFixed(2)} | ATR: ${c}${atr.toFixed(2)}\n` +
      `Profit tier: ${profitTier} | Source: ${sourceLabel(trade.signalSource)}\n` +
      `T212: ${t212Ok ? "✓ Pushed" : "✗ Failed"}`,
    );
  }

  // ── Lightweight intraday scan ───────────────────────────────────────────
  const intradaySignals = await runIntradayScan(openTrades);

  // ── Log poll result ───────────────────────────────────────────────────
  await logPollResult(pollStart, positionsChecked, stopsRatcheted, stopsUnchanged, retryFailures);

  // ── Summary Telegram ──────────────────────────────────────────────────
  await sendSummary(ratchets, intradaySignals, openTrades);

  logLine("INFO", `Poll complete: ${positionsChecked} checked, ${stopsRatcheted} ratcheted, ${stopsUnchanged} unchanged, ${retryFailures} T212 failures`);
}

// ── Lightweight Intraday Scan ───────────────────────────────────────────────

async function runIntradayScan(openTrades: OpenTrade[]): Promise<IntradaySignal[]> {
  const signals: IntradaySignal[] = [];
  try {
    logLine("INFO", "Starting lightweight intraday scan");

    // Get market regime
    let regime: RegimeState | null = null;
    try {
      regime = await calculateMarketRegime();
    } catch (err) {
      logLine("WARN", `Regime fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Only scan in BULLISH regime
    if (!regime || regime.marketRegime !== "BULLISH") {
      logLine("INFO", `Intraday scan skipped — regime: ${regime?.marketRegime ?? "UNKNOWN"}`);
      return signals;
    }

    // Build set of open tickers to exclude
    const openTickers = new Set(openTrades.map((t) => t.ticker.toUpperCase()));

    // Get universe, exclude already-open positions
    const universe = getUniverse().filter(
      (t) => !openTickers.has(t.toUpperCase()),
    );

    logLine("INFO", `Intraday scan: ${universe.length} tickers after excluding ${openTickers.size} open positions`);

    const since = new Date();
    since.setDate(since.getDate() - 60);

    // Scan in batches to avoid hammering Yahoo
    const BATCH = 10;
    for (let i = 0; i < universe.length; i += BATCH) {
      const batch = universe.slice(i, i + BATCH);

      const results = await Promise.allSettled(
        batch.map(async (ticker) => {
          // Get real-time quote for intraday volume
          const quote = await fetchQuote(ticker);
          if (!quote) return null;

          const price = quote.regularMarketPrice;
          const intradayVol = quote.regularMarketVolume;
          const dayHigh = quote.regularMarketDayHigh;
          const dayLow = quote.regularMarketDayLow;
          if (!price || !intradayVol || !dayHigh || !dayLow || dayHigh === dayLow) return null;

          // GBX → GBP for .L tickers
          let adjPrice = price;
          if (ticker.endsWith(".L") && quote.currency !== "GBP") {
            adjPrice = price / 100;
          }

          // Get historical data for average volume
          const candles: DailyQuote[] = await getCachedQuotes(ticker, since);
          if (candles.length < 21) return null;

          const avgVol = calculateAverageVolume(candles, 20);
          if (avgVol <= 0) return null;

          // Volume spike check: intraday volume vs 20-day average
          // Scale factor: if we're mid-day, intraday volume won't match full-day avg
          // Use a conservative 0.5x of daily avg as threshold during the day
          const volRatio = intradayVol / avgVol;
          if (volRatio < 1.0) return null; // At least 1x daily average even intraday

          // Price position: close in top 25% of today's range
          const rangePos = (price - dayLow) / (dayHigh - dayLow);
          if (rangePos < 0.75) return null;

          // Regime assessment for this ticker
          const tickerRegime = calculateTickerRegime(ticker, candles);
          const assessment = assessRegime(regime, tickerRegime);
          if (assessment.overallSignal === "AVOID") return null;

          // ATR for entry/stop
          const atr = calculateATR(candles, 14);
          if (!atr || atr <= 0) return null;

          // Composite score
          const composite: CompositeScore = calculateCompositeScore(
            assessment,
            volRatio,
            candles.slice(-21, -1).reduce((s, q) => s + q.close * q.volume, 0) / 20,
          );

          // Only A and B grades
          if (composite.grade !== "A" && composite.grade !== "B") return null;

          const entry = adjPrice;
          const stop = entry - 1.5 * atr;

          return {
            ticker,
            grade: composite.grade,
            score: Math.round(composite.total * 100),
            volRatio,
            rangePosition: rangePos,
            regime: assessment.overallSignal,
            entry,
            stop,
            risk: entry - stop,
            signalSource: "VOL",
          } satisfies IntradaySignal;
        }),
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value) {
          signals.push(r.value);
        }
      }

      // Small delay between batches
      if (i + BATCH < universe.length) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    logLine("INFO", `Intraday scan complete: ${signals.length} signal(s) found`);

    // Send individual Telegram for each signal
    for (const sig of signals) {
      const c = sym(sig.ticker);
      await notify(
        `🔍 <b>Intraday Signal — ${sig.ticker}</b>\n` +
        `Grade: ${sig.grade} | Score: ${sig.score}\n` +
        `Trigger: Volume spike ${sig.volRatio.toFixed(1)}× avg + close top ${Math.round(sig.rangePosition * 100)}%\n` +
        `Signal: ${sig.signalSource} | Regime: ${sig.regime}\n` +
        `Entry: ${c}${sig.entry.toFixed(2)} | Stop: ${c}${sig.stop.toFixed(2)} | Risk: ${c}${sig.risk.toFixed(2)}`,
      );
    }
  } catch (err) {
    logLine("ERROR", `Intraday scan failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return signals;
}

// ── Summary Telegram ────────────────────────────────────────────────────────

async function sendSummary(
  ratchets: RatchetInfo[],
  intradaySignals: IntradaySignal[],
  openTrades: OpenTrade[],
): Promise<void> {
  const nextPoll = new Date();
  nextPoll.setHours(nextPoll.getHours() + 1);
  const nextStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(nextPoll);

  if (ratchets.length === 0 && intradaySignals.length === 0) {
    await notify(
      `✅ <b>Cruise Control</b> — ${fmtTime()}\n` +
      `No stops updated. No new signals.\n` +
      `Next poll: ${nextStr}`,
    );
    return;
  }

  const lines: string[] = [];
  lines.push(`✅ <b>Cruise Control Complete</b> — ${fmtTime()}`);
  lines.push(`─────────────────────`);

  if (ratchets.length > 0) {
    lines.push(`Stops ratcheted: ${ratchets.length}`);
    for (const r of ratchets) {
      const c = sym(r.ticker);
      lines.push(`${r.ticker}: ${c}${r.oldStop.toFixed(2)} → ${c}${r.newStop.toFixed(2)}`);
    }
    lines.push(`─────────────────────`);
  }

  if (intradaySignals.length > 0) {
    lines.push(`New signals found: ${intradaySignals.length}`);
    for (const s of intradaySignals) {
      lines.push(`${s.ticker} — Grade ${s.grade} (${s.score}) ${s.signalSource}`);
    }
    lines.push(`─────────────────────`);
  }

  // Unchanged positions
  const ratchetedTickers = new Set(ratchets.map((r) => r.ticker));
  const unchanged = openTrades
    .filter((t) => !ratchetedTickers.has(t.ticker))
    .map((t) => t.ticker);
  if (unchanged.length > 0) {
    lines.push(`No action needed: ${unchanged.join(", ")}`);
  }

  lines.push(`Next poll: ${nextStr}`);

  await notify(lines.join("\n"));
}

async function logPollResult(
  pollStart: Date,
  positionsChecked: number,
  stopsRatcheted: number,
  stopsUnchanged: number,
  retryFailures: number,
): Promise<void> {
  const pollEnd = new Date();
  const durationMs = pollEnd.getTime() - pollStart.getTime();

  await db.cruiseControlPollLog.create({
    data: {
      pollStartedAt: pollStart,
      pollCompletedAt: pollEnd,
      durationMs,
      positionsChecked,
      stopsRatcheted,
      stopsUnchanged,
      retryFailures,
      t212Unavailable: retryFailures > 0,
    },
  });

  // Update cruise control state
  const prevState = await db.cruiseControlState.findFirst();
  await db.cruiseControlState.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      isEnabled: true,
      lastPollAt: pollEnd,
      pollCount: 1,
      totalRatchets: stopsRatcheted,
    },
    update: {
      lastPollAt: pollEnd,
      pollCount: (prevState?.pollCount ?? 0) + 1,
      totalRatchets: (prevState?.totalRatchets ?? 0) + stopsRatcheted,
    },
  });
}

// ── Run ─────────────────────────────────────────────────────────────────────

main()
  .then(() => {
    return (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
  })
  .then(() => {
    process.exit(0);
  })
  .catch((err: unknown) => {
    logLine("ERROR", `Fatal error: ${err instanceof Error ? err.message : String(err)}`, {
      stack: err instanceof Error ? err.stack : undefined,
    });
    (prisma as unknown as { $disconnect: () => Promise<void> })
      .$disconnect()
      .finally(() => process.exit(1));
  });
