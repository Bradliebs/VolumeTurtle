/**
 * Cruise Control — Core Engine
 *
 * The daemon that polls open positions hourly during market hours,
 * calculates ratcheted stops, and pushes updates to T212.
 *
 * Manages all three position types:
 * - Momentum (VolumeTurtle + HBME)
 * - PEAD
 * - Pairs long legs (never touches short legs)
 */

import { prisma } from "@/db/client";
import { createLogger } from "@/lib/logger";
import { calculateATR } from "@/lib/risk/atr";
import { getCachedQuotes } from "@/lib/data/quoteCache";
import { calculateRatchetedStop, type PositionType } from "./stop-ratchet";
import {
  getCurrentPrice,
  updateStopOnT212,
  getOpenPositionsFromT212,
  reconcilePositions,
} from "./cruise-control-t212";
import { sendAlert } from "./cruise-control-alerting";
import { isMarketOpen } from "./market-hours";
import { fetchQuote } from "@/lib/data/yahoo";

const log = createLogger("cruise-control");

// Re-export isMarketOpen for convenience
export { isMarketOpen } from "./market-hours";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PollResult {
  pollStartedAt: Date;
  pollCompletedAt: Date;
  durationMs: number;
  positionsChecked: number;
  stopsRatcheted: number;
  stopsSynced: number;
  stopsUnchanged: number;
  retryFailures: number;
  t212Unavailable: boolean;
  ratchets: RatchetDetail[];
}

interface RatchetDetail {
  ticker: string;
  positionType: PositionType;
  oldStop: number;
  newStop: number;
  ratchetPct: number;
  currentPrice: number;
  profitPct: number;
  t212Updated: boolean;
}

export interface CruiseControlStateData {
  isEnabled: boolean;
  enabledAt: Date | null;
  disabledAt: Date | null;
  lastPollAt: Date | null;
  nextPollAt: Date | null;
  pollCount: number;
  totalRatchets: number;
}

interface OpenPosition {
  id: string;
  ticker: string;
  entryPrice: number;
  entryDate: Date;
  shares: number;
  hardStop: number;
  trailingStop: number;
  hardStopPrice: number | null;
  trailingStopPrice: number | null;
  peakClosePrice: number | null;
  signalSource: string;
}

// ── Typed Prisma Access ─────────────────────────────────────────────────────

const db = prisma as unknown as {
  cruiseControlState: {
    findFirst: () => Promise<{
      id: number;
      isEnabled: boolean;
      enabledAt: Date | null;
      disabledAt: Date | null;
      lastPollAt: Date | null;
      nextPollAt: Date | null;
      pollCount: number;
      totalRatchets: number;
    } | null>;
    upsert: (args: {
      where: { id: number };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  cruiseControlRatchetEvent: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  cruiseControlPollLog: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  trade: {
    findMany: (args: unknown) => Promise<OpenPosition[]>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
};

// ── VIX Check ───────────────────────────────────────────────────────────────

async function checkVix(): Promise<number | null> {
  try {
    const quote = await fetchQuote("^VIX");
    return quote?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

// ── State Management ────────────────────────────────────────────────────────

/**
 * Get the current cruise control state from the database.
 */
export async function getCruiseControlState(): Promise<CruiseControlStateData> {
  const state = await db.cruiseControlState.findFirst();
  if (!state) {
    return {
      isEnabled: false,
      enabledAt: null,
      disabledAt: null,
      lastPollAt: null,
      nextPollAt: null,
      pollCount: 0,
      totalRatchets: 0,
    };
  }
  return state;
}

async function updateState(data: Record<string, unknown>): Promise<void> {
  await db.cruiseControlState.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
}

// ── Ghost Position Tracking ──────────────────────────────────────────────────

/**
 * Tracks consecutive ghost detections per ticker.
 * First detection = warning. ≥2 consecutive = critical alert + auto-close.
 * Cleared when a ticker is no longer ghost.
 */
const ghostTracker: Map<string, number> = new Map();

// ── Retry Queue ─────────────────────────────────────────────────────────────

interface RetryItem {
  position: OpenPosition;
  positionType: PositionType;
  newStop: number;
  currentPrice: number;
  atr: number;
  attempts: number;
}

const retryQueue: Map<string, RetryItem> = new Map();
let retryTimerRef: ReturnType<typeof setInterval> | null = null;

function startRetryTimer(): void {
  if (retryTimerRef) return;
  retryTimerRef = setInterval(processRetryQueue, 10 * 60 * 1000); // every 10 minutes
}

function stopRetryTimer(): void {
  if (retryTimerRef) {
    clearInterval(retryTimerRef);
    retryTimerRef = null;
  }
}

async function processRetryQueue(): Promise<void> {
  if (retryQueue.size === 0) return;

  for (const [key, item] of retryQueue) {
    if (item.attempts >= 5) {
      // Max retries — alert but don't panic; next poll cycle will recalculate
      retryQueue.delete(key);
      await sendAlert("warning", `T212 stop update failed after 5 attempts: ${item.position.ticker} — will retry next poll cycle`, {
        ticker: item.position.ticker,
        positionType: item.positionType,
        newStop: item.newStop,
        attempts: item.attempts,
      });
      log.warn(
        { ticker: item.position.ticker, newStop: item.newStop },
        "[CRUISE-CONTROL] Retry exhausted — stop is saved in DB, will re-attempt on next poll",
      );
      continue;
    }

    item.attempts++;
    log.info({ ticker: item.position.ticker, attempt: item.attempts }, "[CRUISE-CONTROL] Retrying T212 stop update");

    const result = await updateStopOnT212(
      item.position.ticker,
      item.position.shares,
      Math.max(item.position.hardStop, item.position.trailingStop),
      item.newStop,
    );

    if (result.success) {
      retryQueue.delete(key);
      // Record the ratchet event now that T212 is updated
      await recordRatchetEvent(item, true, result.t212Response ?? null);
    }
    // If still failing, stays in queue for next retry cycle
  }
}

async function recordRatchetEvent(
  item: RetryItem,
  t212Updated: boolean,
  t212Response: string | null,
): Promise<void> {
  const currentStop = Math.max(item.position.hardStop, item.position.trailingStop);
  const profitPct = ((item.currentPrice - item.position.entryPrice) / item.position.entryPrice) * 100;
  const ratchetPct = currentStop > 0 ? ((item.newStop - currentStop) / currentStop) * 100 : 0;

  await db.cruiseControlRatchetEvent.create({
    data: {
      positionType: item.positionType,
      positionId: item.position.id,
      ticker: item.position.ticker,
      pollTimestamp: new Date(),
      oldStop: currentStop,
      newStop: item.newStop,
      ratchetPct,
      currentPrice: item.currentPrice,
      profitPct,
      atrUsed: item.atr,
      t212Updated,
      t212Response,
    },
  });
}

// ── Position Classification ─────────────────────────────────────────────────

function classifyPosition(trade: OpenPosition): PositionType {
  const source = trade.signalSource?.toLowerCase() ?? "";
  if (source === "pead") return "pead";
  if (source === "pairs-long" || source === "pairs_long") return "pairs-long";
  // Default: momentum (volume, momentum, manual, hbme)
  return "momentum";
}

// ── Single Poll Cycle ───────────────────────────────────────────────────────

/**
 * Run one full poll cycle. Checks all open positions, calculates ratchets,
 * updates T212 and database.
 */
export async function runSinglePoll(): Promise<PollResult> {
  const pollStart = new Date();
  const ratchets: RatchetDetail[] = [];
  let positionsChecked = 0;
  let stopsRatcheted = 0;
  let stopsSynced = 0;
  let stopsUnchanged = 0;
  let retryFailures = 0;
  let t212Unavailable = false;

  try {
    // Load all open trades
    const openTrades: OpenPosition[] = await db.trade.findMany({
      where: { status: "OPEN" },
    });

    if (openTrades.length === 0) {
      log.info("[CRUISE-CONTROL] No open positions — poll complete");
      const pollEnd = new Date();
      const result: PollResult = {
        pollStartedAt: pollStart,
        pollCompletedAt: pollEnd,
        durationMs: pollEnd.getTime() - pollStart.getTime(),
        positionsChecked: 0,
        stopsRatcheted: 0,
        stopsSynced: 0,
        stopsUnchanged: 0,
        retryFailures: 0,
        t212Unavailable: false,
        ratchets: [],
      };
      await logPoll(result);
      return result;
    }

    // Check VIX for warning
    const vix = await checkVix();
    if (vix != null && vix > 30) {
      await sendAlert("warning", `VIX at ${vix.toFixed(1)} during market hours — regime change mid-session`, {
        vix,
      });
    }

    // Reconcile T212 vs DB and build T212 stop map
    const t212Positions = await getOpenPositionsFromT212();
    const t212StopMap = new Map<string, number>();
    for (const pos of t212Positions) {
      if (pos.stopLoss != null && pos.stopLoss > 0) {
        t212StopMap.set(pos.ticker.toUpperCase(), pos.stopLoss);
      }
    }
    if (t212Positions.length > 0) {
      const recon = reconcilePositions(
        t212Positions,
        openTrades.map((t) => ({ ticker: t.ticker, status: "OPEN" })),
      );
      if (recon.orphaned.length > 0) {
        await sendAlert("critical", `Orphaned T212 positions detected: ${recon.orphaned.join(", ")}`, {
          orphaned: recon.orphaned,
        });
      }

      // ── Ghost position handling (deduplication + auto-close) ──────────
      // Clear ghosts that resolved themselves
      for (const tracked of ghostTracker.keys()) {
        if (!recon.ghost.includes(tracked)) {
          ghostTracker.delete(tracked);
          log.info({ ticker: tracked }, "[CRUISE-CONTROL] Ghost resolved — ticker reappeared in T212");
        }
      }

      for (const ghostTicker of recon.ghost) {
        const prevCount = ghostTracker.get(ghostTicker) ?? 0;
        const newCount = prevCount + 1;
        ghostTracker.set(ghostTicker, newCount);

        if (newCount === 1) {
          // First detection — warn only, could be transient cache staleness
          await sendAlert("warning", `Possible ghost position: ${ghostTicker} is in DB but not in T212 — monitoring`, {
            ticker: ghostTicker,
            consecutiveDetections: newCount,
          });
        } else if (newCount === 2) {
          // Confirmed ghost — auto-close in DB
          const ghostTrade = openTrades.find(
            (t) => t.ticker.toUpperCase() === ghostTicker,
          );
          if (ghostTrade) {
            await db.trade.update({
              where: { id: ghostTrade.id },
              data: {
                status: "CLOSED",
                exitDate: new Date(),
                exitReason: "T212_STOP",
              },
            });
            await sendAlert("critical", `Ghost confirmed & auto-closed: ${ghostTicker} — position stopped out on T212 but DB was stale`, {
              ticker: ghostTicker,
              tradeId: ghostTrade.id,
              consecutiveDetections: newCount,
            });
            log.warn(
              { ticker: ghostTicker, tradeId: ghostTrade.id },
              "[CRUISE-CONTROL] Ghost position auto-closed in DB",
            );
          }
          ghostTracker.delete(ghostTicker);
        }
        // No further alerts for count > 2 (already closed)
      }
    }

    // Process each position
    const since = new Date();
    since.setDate(since.getDate() - 60);

    for (const trade of openTrades) {
      positionsChecked++;
      const positionType = classifyPosition(trade);

      // Get current price
      const currentPrice = await getCurrentPrice(trade.ticker);
      if (currentPrice == null) {
        log.warn({ ticker: trade.ticker }, "[CRUISE-CONTROL] Could not get price — skipping");
        stopsUnchanged++;
        continue;
      }

      // Calculate ATR(14) from cached daily data
      const candles = await getCachedQuotes(trade.ticker, since);
      if (candles.length < 6) {
        log.info({ ticker: trade.ticker, candles: candles.length }, "[CRUISE-CONTROL] Insufficient data for ATR — skipping");
        stopsUnchanged++;
        continue;
      }

      const atr = calculateATR(candles, 14);
      if (atr == null || atr <= 0) {
        log.info({ ticker: trade.ticker }, "[CRUISE-CONTROL] ATR calculation returned null — skipping");
        stopsUnchanged++;
        continue;
      }

      // Current active stop
      const currentStop = Math.max(
        trade.hardStopPrice ?? trade.hardStop,
        trade.trailingStopPrice ?? trade.trailingStop,
      );

      // Days since entry
      const daysSinceEntry = Math.floor(
        (Date.now() - new Date(trade.entryDate).getTime()) / (1000 * 60 * 60 * 24),
      );

      // Calculate ratcheted stop
      const newStop = calculateRatchetedStop({
        positionType,
        entryPrice: trade.entryPrice,
        currentStop,
        currentPrice,
        atr,
        daysSinceEntry,
      });

      if (newStop == null) {
        // No ratchet needed — but check if T212 stop is behind system stop
        const t212Stop = t212StopMap.get(trade.ticker.toUpperCase()) ?? null;
        if (t212Stop != null && currentStop > t212Stop + 0.01) {
          log.info(
            { ticker: trade.ticker, systemStop: currentStop, t212Stop },
            `[CRUISE-CONTROL] T212 stop behind system — syncing: ${t212Stop.toFixed(2)} → ${currentStop.toFixed(2)}`,
          );
          const syncResult = await updateStopOnT212(trade.ticker, trade.shares, t212Stop, currentStop);
          if (syncResult.success) {
            stopsSynced++;
            await sendAlert("info", `${trade.ticker} T212 stop synced to system: ${t212Stop.toFixed(2)} → ${currentStop.toFixed(2)}`, {
              ticker: trade.ticker,
              t212Stop,
              systemStop: currentStop,
            });
          } else {
            log.warn({ ticker: trade.ticker, err: syncResult.error }, "[CRUISE-CONTROL] Failed to sync T212 stop");
          }
        }
        stopsUnchanged++;
        continue;
      }

      // We have a ratchet — update DB
      stopsRatcheted++;

      const profitPct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
      const ratchetPct = currentStop > 0 ? ((newStop - currentStop) / currentStop) * 100 : 0;

      // Update trade in DB
      await db.trade.update({
        where: { id: trade.id },
        data: {
          trailingStop: newStop,
          trailingStopPrice: newStop,
        },
      });

      // Push to T212
      const t212Result = await updateStopOnT212(trade.ticker, trade.shares, currentStop, newStop);

      if (!t212Result.success) {
        // Queue for retry — don't fail the poll
        t212Unavailable = true;
        retryQueue.set(trade.id, {
          position: trade,
          positionType,
          newStop,
          currentPrice,
          atr,
          attempts: 0,
        });
      } else {
        // Record ratchet event
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
            t212Updated: true,
            t212Response: t212Result.t212Response ?? null,
          },
        });
      }

      // Check single ratchet > 10%
      if (ratchetPct > 10) {
        await sendAlert("warning", `${trade.ticker} stop ratcheted by ${ratchetPct.toFixed(1)}% in one poll`, {
          ticker: trade.ticker,
          oldStop: currentStop,
          newStop,
          ratchetPct,
        });
      }

      ratchets.push({
        ticker: trade.ticker,
        positionType,
        oldStop: currentStop,
        newStop,
        ratchetPct,
        currentPrice,
        profitPct,
        t212Updated: t212Result.success,
      });
    }

    // Check coordinated moves warning
    if (stopsRatcheted > 3) {
      await sendAlert("warning", `${stopsRatcheted} positions ratcheted in one poll — possible coordinated move/news event`, {
        ratcheted: stopsRatcheted,
        tickers: ratchets.map((r) => r.ticker),
      });
    }

    // Start retry timer if needed
    if (retryQueue.size > 0) {
      startRetryTimer();
      retryFailures = retryQueue.size;
    }
  } catch (err) {
    log.error({ err: String(err) }, "[CRUISE-CONTROL] Poll cycle error");
    await sendAlert("critical", `Cruise control poll error: ${err instanceof Error ? err.message : String(err)}`);
  }

  const pollEnd = new Date();
  const durationMs = pollEnd.getTime() - pollStart.getTime();

  // Performance warning
  if (durationMs > 5 * 60 * 1000) {
    await sendAlert("warning", `[CRUISE-CONTROL-WARN] Poll took ${durationMs}ms — performance review needed`, {
      durationMs,
      positionsChecked,
    });
  }

  const result: PollResult = {
    pollStartedAt: pollStart,
    pollCompletedAt: pollEnd,
    durationMs,
    positionsChecked,
    stopsRatcheted,
    stopsSynced,
    stopsUnchanged,
    retryFailures,
    t212Unavailable,
    ratchets,
  };

  await logPoll(result);

  // Update state
  const nextPoll = new Date();
  nextPoll.setMinutes(nextPoll.getMinutes() + 60);

  const prevState = await db.cruiseControlState.findFirst();
  await updateState({
    lastPollAt: pollEnd,
    nextPollAt: nextPoll,
    pollCount: (prevState?.pollCount ?? 0) + 1,
    totalRatchets: (prevState?.totalRatchets ?? 0) + stopsRatcheted,
  });

  await sendAlert("info", `Poll complete: ${positionsChecked} checked, ${stopsRatcheted} ratcheted, ${stopsSynced} synced, ${retryFailures} retry failures`, {
    durationMs,
    positionsChecked,
    stopsRatcheted,
    stopsSynced,
    stopsUnchanged,
    retryFailures,
  });

  return result;
}

async function logPoll(result: PollResult): Promise<void> {
  await db.cruiseControlPollLog.create({
    data: {
      pollStartedAt: result.pollStartedAt,
      pollCompletedAt: result.pollCompletedAt,
      durationMs: result.durationMs,
      positionsChecked: result.positionsChecked,
      stopsRatcheted: result.stopsRatcheted,
      stopsUnchanged: result.stopsUnchanged,
      retryFailures: result.retryFailures,
      t212Unavailable: result.t212Unavailable,
    },
  });
}

// ── Daemon Control ──────────────────────────────────────────────────────────

// Use globalThis to survive HMR in development
const g = globalThis as unknown as {
  __ccPollInterval?: ReturnType<typeof setInterval> | null;
  __ccDaemonRunning?: boolean;
  __ccPollInProgress?: boolean;
};

function getPollIntervalRef() { return g.__ccPollInterval ?? null; }
function setPollIntervalRef(ref: ReturnType<typeof setInterval> | null) { g.__ccPollInterval = ref; }
function isDaemonRunningInternal() { return g.__ccDaemonRunning ?? false; }
function setDaemonRunning(v: boolean) { g.__ccDaemonRunning = v; }

/**
 * Start the cruise control daemon.
 * Polls every 60 minutes during market hours.
 */
export async function startCruiseControl(): Promise<void> {
  if (isDaemonRunningInternal()) {
    log.info("[CRUISE-CONTROL] Already running — ignoring start request");
    return;
  }

  // Clear any orphaned interval from HMR
  const oldRef = getPollIntervalRef();
  if (oldRef) clearInterval(oldRef);

  setDaemonRunning(true);
  await updateState({ isEnabled: true, enabledAt: new Date() });
  await sendAlert("info", "Cruise control turned ON");
  log.info("[CRUISE-CONTROL] State: ON — polling every 60 minutes");

  // Immediate poll if market is open
  if (isMarketOpen()) {
    try {
      await runSinglePoll();
    } catch (err) {
      log.error({ err: String(err) }, "[CRUISE-CONTROL] Initial poll failed");
    }
  } else {
    log.info("[CRUISE-CONTROL] Market closed — will poll when market opens");
  }

  // Schedule hourly polls
  setPollIntervalRef(setInterval(async () => {
    if (!isDaemonRunningInternal()) return;

    if (!isMarketOpen()) {
      log.info("[CRUISE-CONTROL] Market closed — poll skipped");
      return;
    }

    // Guard against concurrent polls
    if (g.__ccPollInProgress) {
      log.warn("[CRUISE-CONTROL] Previous poll still running — skipping this cycle");
      return;
    }

    try {
      g.__ccPollInProgress = true;
      await runSinglePoll();
    } catch (err) {
      log.error({ err: String(err) }, "[CRUISE-CONTROL] Poll cycle crashed");
      await sendAlert("critical", `Cruise control daemon poll crashed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      g.__ccPollInProgress = false;
    }
  }, 60 * 60 * 1000)); // 60 minutes
}

/**
 * Gracefully stop the cruise control daemon.
 */
export async function stopCruiseControl(): Promise<void> {
  if (!isDaemonRunningInternal()) {
    log.info("[CRUISE-CONTROL] Already stopped — ignoring stop request");
    return;
  }

  setDaemonRunning(false);

  const ref = getPollIntervalRef();
  if (ref) {
    clearInterval(ref);
    setPollIntervalRef(null);
  }

  stopRetryTimer();
  retryQueue.clear();
  ghostTracker.clear();

  await updateState({ isEnabled: false, disabledAt: new Date() });
  await sendAlert("info", "Cruise control turned OFF");
  log.info("[CRUISE-CONTROL] State: OFF — dormant");
}

/**
 * Check if the daemon is currently running.
 */
export function isDaemonRunning(): boolean {
  return isDaemonRunningInternal();
}

/**
 * Initialize from database state on startup.
 * If state was ON, begins polling immediately.
 */
export async function initFromDbState(): Promise<void> {
  const state = await getCruiseControlState();
  if (state.isEnabled) {
    log.info("[CRUISE-CONTROL] Restoring state: ON from database — starting daemon");
    await startCruiseControl();
  } else {
    log.info("[CRUISE-CONTROL] State: OFF — dormant");
  }
}

// Graceful shutdown — use globalThis guard to prevent duplicate handlers on HMR
const gShutdown = globalThis as unknown as { __ccShutdownRegistered?: boolean };
if (!gShutdown.__ccShutdownRegistered) {
  gShutdown.__ccShutdownRegistered = true;
  const shutdown = async () => { await stopCruiseControl(); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
