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
  retryQueue: {
    create: (args: { data: Record<string, unknown> }) => Promise<RetryQueueRow>;
    findMany: (args: unknown) => Promise<RetryQueueRow[]>;
    update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<unknown>;
    delete: (args: { where: { id: number } }) => Promise<unknown>;
  };
  cruiseControlAlert: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  appSettings: {
    findFirst: (args: { orderBy: { id: "asc" } }) => Promise<{
      cruisePollIntervalMins?: number;
      cruisePollFastIntervalMins?: number;
      cruisePollFastStartUtcHour?: number;
      cruisePollFastEndUtcHour?: number;
    } | null>;
  };
};

interface RetryQueueRow {
  id: number;
  ticker: string;
  stopPrice: number;
  quantity: number;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  nextRetryAt: Date;
}

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
 * Uses globalThis to survive HMR in development.
 */
const gTrackers = globalThis as unknown as {
  __ccGhostTracker?: Map<string, number>;
  __ccOrphanTracker?: Set<string>;
  __ccRetryTimerRef?: ReturnType<typeof setInterval> | null;
};
if (!gTrackers.__ccGhostTracker) gTrackers.__ccGhostTracker = new Map();
if (!gTrackers.__ccOrphanTracker) gTrackers.__ccOrphanTracker = new Set();
const ghostTracker: Map<string, number> = gTrackers.__ccGhostTracker;
const orphanTracker: Set<string> = gTrackers.__ccOrphanTracker;

// ── Retry Queue (DB-persisted) ──────────────────────────────────────────────

interface RetryItem {
  position: OpenPosition;
  positionType: PositionType;
  newStop: number;
  currentPrice: number;
  atr: number;
  attempts: number;
}

let retryTimerRef: ReturnType<typeof setInterval> | null = gTrackers.__ccRetryTimerRef ?? null;

function startRetryTimer(): void {
  if (retryTimerRef) return;
  retryTimerRef = setInterval(processRetryQueue, 10 * 60 * 1000); // every 10 minutes
  gTrackers.__ccRetryTimerRef = retryTimerRef;
}

function stopRetryTimer(): void {
  if (retryTimerRef) {
    clearInterval(retryTimerRef);
    retryTimerRef = null;
    gTrackers.__ccRetryTimerRef = null;
  }
}

/** Enqueue a failed stop push to the DB-backed retry queue. */
async function enqueueRetry(item: RetryItem, error?: string): Promise<void> {
  // Exponential backoff: 10min, 20min, 40min, 60min, 60min... (capped at 60min)
  const backoffMs = Math.min(10 * 60 * 1000 * Math.pow(2, item.attempts), 60 * 60 * 1000);
  await db.retryQueue.create({
    data: {
      ticker: item.position.ticker,
      stopPrice: item.newStop,
      quantity: item.position.shares,
      attempts: item.attempts,
      lastError: error ?? null,
      nextRetryAt: new Date(Date.now() + backoffMs),
    },
  });
  log.info({ ticker: item.position.ticker, newStop: item.newStop, backoffMin: Math.round(backoffMs / 60000) }, "[CRUISE-CONTROL] Queued failed stop push for DB-persisted retry");
}

async function processRetryQueue(): Promise<void> {
  let rows: RetryQueueRow[];
  try {
    rows = await db.retryQueue.findMany({
      where: {
        nextRetryAt: { lte: new Date() },
        attempts: { lt: 15 },
      },
    });
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, "[CRUISE-CONTROL] Failed to load retry queue from DB");
    return;
  }

  if (rows.length === 0) return;

  for (const row of rows) {
    if (row.attempts >= 15) {
      // Max retries reached \u2014 mark as TERMINAL but do NOT delete (preserve forensics).
      // The findMany filter (attempts: { lt: 15 }) already excludes these from future polls.
      // Bump attempts to a sentinel value (99) and prefix lastError so it's obvious in DB inspection.
      await db.retryQueue.update({
        where: { id: row.id },
        data: {
          attempts: 99,
          lastError: `TERMINAL after 15 attempts: ${row.lastError ?? "unknown"}`,
          nextRetryAt: new Date("2099-01-01"),
        },
      });
      await sendAlert("warning", `T212 stop update failed after 15 attempts: ${row.ticker} \u2014 manual intervention needed`, {
        ticker: row.ticker,
        stopPrice: row.stopPrice,
        attempts: row.attempts,
      });
      await db.cruiseControlAlert.create({
        data: {
          alertType: "warning",
          message: `Retry exhausted for ${row.ticker} stop at ${row.stopPrice} after ${row.attempts} attempts \u2014 MANUAL SET REQUIRED (RetryQueue row #${row.id} preserved for forensics)`,
          context: { ticker: row.ticker, stopPrice: row.stopPrice, retryQueueRowId: row.id },
        },
      });
      log.warn({ ticker: row.ticker, stopPrice: row.stopPrice, rowId: row.id }, "[CRUISE-CONTROL] Retry exhausted \u2014 marked TERMINAL (row preserved)");
      continue;
    }

    const newAttempts = row.attempts + 1;
    log.info({ ticker: row.ticker, attempt: newAttempts }, "[CRUISE-CONTROL] Retrying T212 stop update from DB queue");

    const result = await updateStopOnT212(
      row.ticker,
      row.quantity,
      0, // old stop unknown — floor enforced by T212 layer
      row.stopPrice,
    );

    if (result.success) {
      await db.retryQueue.delete({ where: { id: row.id } });
      log.info({ ticker: row.ticker, stopPrice: row.stopPrice }, "[CRUISE-CONTROL] Retry succeeded — removed from queue");
    } else {
      // Update attempts and push next retry forward
      // Exponential backoff on retry interval
      const backoffMs = Math.min(10 * 60 * 1000 * Math.pow(2, newAttempts), 60 * 60 * 1000);
      await db.retryQueue.update({
        where: { id: row.id },
        data: {
          attempts: newAttempts,
          lastError: result.error ?? null,
          nextRetryAt: new Date(Date.now() + backoffMs),
        },
      });
    }
  }
}

/** On daemon startup, process any existing RetryQueue rows immediately. */
export async function drainRetryQueueOnStartup(): Promise<void> {
  log.info("[CRUISE-CONTROL] Checking for persisted retry queue items from previous session...");
  await processRetryQueue();
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
    let t212FetchOk = false;
    const t212Positions = await getOpenPositionsFromT212();
    const t212StopMap = new Map<string, number>();
    if (t212Positions.length > 0) {
      t212FetchOk = true;
    }
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
      // ── Orphan position handling (deduplication) ─────────────────
      // Clear orphans that resolved themselves
      for (const tracked of orphanTracker) {
        if (!recon.orphaned.includes(tracked)) {
          orphanTracker.delete(tracked);
          log.info({ ticker: tracked }, "[CRUISE-CONTROL] Orphan resolved — ticker now tracked in DB");
        }
      }

      // Only alert for newly-detected orphans
      const newOrphans = recon.orphaned.filter((t) => !orphanTracker.has(t));
      for (const ticker of recon.orphaned) {
        orphanTracker.add(ticker);
      }
      if (newOrphans.length > 0) {
        await sendAlert("warning", `Orphaned T212 positions detected: ${newOrphans.join(", ")}`, {
          orphaned: newOrphans,
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
          // Second detection — force a fresh T212 fetch (bypass 1-min cache).
          // If ticker reappears in fresh data, clear tracker (was cache staleness).
          // If still missing, leave tracker at 2 and wait for 3rd poll to confirm.
          try {
            const fresh = await getOpenPositionsFromT212({ forceRefresh: true });
            const stillGhost = !fresh.some((p) => p.ticker.toUpperCase() === ghostTicker);
            if (!stillGhost) {
              ghostTracker.delete(ghostTicker);
              log.info({ ticker: ghostTicker }, "[CRUISE-CONTROL] Ghost cleared by force-refresh — was cache staleness");
              await sendAlert("info", `Ghost ${ghostTicker} cleared — fresh T212 fetch confirms position exists`, {
                ticker: ghostTicker,
              });
            } else {
              await sendAlert("warning", `Ghost confirmed by fresh fetch: ${ghostTicker} — will auto-close on next poll if still missing`, {
                ticker: ghostTicker,
                consecutiveDetections: newCount,
              });
            }
          } catch (refreshErr) {
            log.error({ ticker: ghostTicker, err: String(refreshErr) }, "[CRUISE-CONTROL] Force-refresh failed during ghost confirmation");
          }
        } else if (newCount >= 3) {
          // Third confirmed detection across 3 polls (~3 hours) — auto-close in DB
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
            await sendAlert("critical", `Ghost confirmed & auto-closed (3 polls): ${ghostTicker} — position stopped out on T212 but DB was stale`, {
              ticker: ghostTicker,
              tradeId: ghostTrade.id,
              consecutiveDetections: newCount,
            });
            log.warn(
              { ticker: ghostTicker, tradeId: ghostTrade.id, consecutiveDetections: newCount },
              "[CRUISE-CONTROL] Ghost position auto-closed in DB after 3 confirmed polls",
            );
          }
          ghostTracker.delete(ghostTicker);
        }
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

      // We have a ratchet — push to T212 FIRST, then update DB (prevents desync if T212 push fails)
      stopsRatcheted++;

      const profitPct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
      const ratchetPct = currentStop > 0 ? ((newStop - currentStop) / currentStop) * 100 : 0;

      // If T212 floor check failed this poll, skip ratchets to avoid pushing below T212's actual stop
      if (!t212FetchOk && t212StopMap.size === 0) {
        log.warn(
          { ticker: trade.ticker, newStop },
          "[CRUISE-CONTROL] Skipping ratchet — T212 positions unavailable, floor rule cannot be enforced",
        );
        stopsUnchanged++;
        continue;
      }

      // Push to T212 first
      const t212Result = await updateStopOnT212(trade.ticker, trade.shares, currentStop, newStop);

      if (!t212Result.success) {
        // T212 push failed — do NOT update DB (keep stops in sync)
        t212Unavailable = true;
        await enqueueRetry({
          position: trade,
          positionType,
          newStop,
          currentPrice,
          atr,
          attempts: 0,
        }, t212Result.error ?? undefined);
      } else {
        // T212 push succeeded — now safe to update DB
        await db.trade.update({
          where: { id: trade.id },
          data: {
            trailingStop: newStop,
            trailingStopPrice: newStop,
          },
        });

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

    // Start retry timer if needed (check DB for pending retries)
    if (t212Unavailable) {
      startRetryTimer();
      try {
        const pendingRetries = await db.retryQueue.findMany({
          where: { attempts: { lt: 15 } },
        });
        retryFailures = pendingRetries.length;
      } catch {
        // Non-critical — count will be approximate
      }
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
  __ccConsecutivePollFailures?: number;
};

function getPollIntervalRef() { return g.__ccPollInterval ?? null; }
function setPollIntervalRef(ref: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null) {
  g.__ccPollInterval = ref as ReturnType<typeof setInterval> | null;
}
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
  const sched = await getPollSchedule();
  log.info(
    {
      baseMins: sched.baseMs / 60_000,
      fastMins: sched.fastMs / 60_000,
      fastWindowUtc: `${sched.fastStartHour}-${sched.fastEndHour}`,
    },
    "[CRUISE-CONTROL] State: ON \u2014 adaptive polling (fast during high-action UTC window, base off-peak)",
  );

  // On startup: drain any persisted retry queue items from previous session
  await drainRetryQueueOnStartup();

  // Start retry timer unconditionally so any items enqueued by autoExecutor
  // (e.g. failed L1 stop pushes after market fills) are processed within ~10 min,
  // even if no cruise poll has triggered the timer via t212Unavailable yet.
  startRetryTimer();

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

  // Self-rescheduling poll loop. Uses setTimeout (not setInterval) so each
  // cycle can pick the right interval based on current UTC hour: fast (default
  // 30 min) during the high-action window (default 08:00-16:00 UTC weekdays),
  // base interval (default 60 min) otherwise. Both intervals + window
  // boundaries are tunable via AppSettings.cruisePoll* fields.
  scheduleNextPoll();
}

/**
 * Read poll-cadence settings from AppSettings; fall back to defaults if missing.
 */
async function getPollSchedule(): Promise<{
  baseMs: number;
  fastMs: number;
  fastStartHour: number;
  fastEndHour: number;
}> {
  try {
    const s = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
    return {
      baseMs: ((s?.cruisePollIntervalMins as number | undefined) ?? 60) * 60_000,
      fastMs: ((s?.cruisePollFastIntervalMins as number | undefined) ?? 30) * 60_000,
      fastStartHour: (s?.cruisePollFastStartUtcHour as number | undefined) ?? 8,
      fastEndHour: (s?.cruisePollFastEndUtcHour as number | undefined) ?? 16,
    };
  } catch {
    return { baseMs: 60 * 60_000, fastMs: 30 * 60_000, fastStartHour: 8, fastEndHour: 16 };
  }
}

function isInFastWindow(hourUtc: number, dayUtc: number, fastStart: number, fastEnd: number): boolean {
  // Weekdays only (1-5 Mon-Fri); fast window is [start, end) in UTC hours
  if (dayUtc === 0 || dayUtc === 6) return false;
  return hourUtc >= fastStart && hourUtc < fastEnd;
}

function scheduleNextPoll(): void {
  if (!isDaemonRunningInternal()) return;

  // Clear any prior scheduled timeout
  const old = getPollIntervalRef();
  if (old) clearTimeout(old);

  // Pick interval based on current UTC time
  void (async () => {
    const sched = await getPollSchedule();
    const now = new Date();
    const fast = isInFastWindow(now.getUTCHours(), now.getUTCDay(), sched.fastStartHour, sched.fastEndHour);
    const intervalMs = fast ? sched.fastMs : sched.baseMs;

    const ref = setTimeout(async () => {
      await runScheduledPoll();
      scheduleNextPoll(); // chain to next cycle, re-evaluating window
    }, intervalMs);
    setPollIntervalRef(ref);
  })();
}

async function runScheduledPoll(): Promise<void> {
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

  // Circuit breaker: if last 3 polls failed, skip this cycle.
  // After 5 consecutive failures, send a single escalated alert and keep skipping.
  const consecutiveFailures = (g.__ccConsecutivePollFailures as number | undefined) ?? 0;
  if (consecutiveFailures >= 3 && consecutiveFailures < 8) {
    log.warn({ consecutiveFailures }, "[CRUISE-CONTROL] Circuit breaker: skipping poll due to recent failures");
    return;
  }
  if (consecutiveFailures === 5) {
    await sendAlert("critical", `Cruise control daemon has failed ${consecutiveFailures} consecutive polls — likely DB or network issue. Manual investigation needed.`);
  }
  // After 8 failures, allow one probe attempt to detect recovery
  if (consecutiveFailures >= 8) {
    log.info({ consecutiveFailures }, "[CRUISE-CONTROL] Circuit breaker: probing for recovery");
  }

  try {
    g.__ccPollInProgress = true;
    await runSinglePoll();
    // Success — reset failure counter
    if (consecutiveFailures > 0) {
      log.info({ previousFailures: consecutiveFailures }, "[CRUISE-CONTROL] Poll recovered after failures");
      g.__ccConsecutivePollFailures = 0;
    }
  } catch (err) {
    g.__ccConsecutivePollFailures = consecutiveFailures + 1;
    log.error({ err: String(err), consecutiveFailures: g.__ccConsecutivePollFailures }, "[CRUISE-CONTROL] Poll cycle crashed");
    // Only alert on first failure to avoid spam (escalation alert handled above at threshold 5)
    if (consecutiveFailures === 0) {
      await sendAlert("critical", `Cruise control daemon poll crashed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    g.__ccPollInProgress = false;
  }
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
  // DB-persisted retry queue survives restarts — no need to clear
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
