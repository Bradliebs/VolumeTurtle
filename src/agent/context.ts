import { prisma } from "@/db/client";
import { calculateMarketRegime } from "@/lib/signals/regimeFilter";
import { applyDbSettings } from "@/lib/config";
import { getCachedT212Positions, loadT212Settings } from "@/lib/t212/client";
import { sendTelegram } from "@/lib/telegram";
import { readFailureCount } from "./failureTracker";
import * as fs from "fs";
import * as path from "path";

const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
  };
  pendingOrder: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
  accountSnapshot: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
  appSettings: { findFirst: () => Promise<Record<string, unknown> | null> };
  agentHaltFlag: { findFirst: () => Promise<Record<string, unknown> | null> };
  agentDecisionLog: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
  cruiseControlRatchetEvent: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
  stopHistory: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
  timeStopFlag: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
};

// Ghost-position miss counter — persisted to disk so it survives across
// one-shot `npm run agent` invocations (each spawns a fresh Node process).
// Keyed by Trade.id (cuid string). Reset to 0 when the position reappears
// in T212. After 2 consecutive cycles missing from T212, the trade is
// auto-closed in the DB with exitReason "GHOST_POSITION — T212 reconciliation".
const GHOST_TRACKER_PATH = path.join(process.cwd(), "data", "ghost-tracker.json");

function loadGhostTracker(): Map<string, number> {
  try {
    if (fs.existsSync(GHOST_TRACKER_PATH)) {
      const raw = JSON.parse(fs.readFileSync(GHOST_TRACKER_PATH, "utf-8")) as Record<string, number>;
      return new Map(Object.entries(raw));
    }
  } catch { /* corrupt file — start fresh */ }
  return new Map();
}

function saveGhostTracker(tracker: Map<string, number>): void {
  try {
    const dir = path.dirname(GHOST_TRACKER_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(GHOST_TRACKER_PATH, JSON.stringify(Object.fromEntries(tracker), null, 2));
  } catch { /* best effort — next cycle will start fresh */ }
}

/**
 * Cross-check open DB trades against live T212 positions and auto-close
 * any trade missing from T212 for 2+ consecutive agent cycles.
 *
 * Returns the set of trade IDs that were closed this cycle so the caller
 * can exclude them from the returned context.
 */
async function reconcileGhostPositions(
  openTrades: Array<Record<string, unknown>>
): Promise<Set<string>> {
  const closedThisCycle = new Set<string>();

  const settings = loadT212Settings();
  if (!settings) {
    return closedThisCycle;
  }

  let t212Tickers: Set<string>;
  try {
    const { positions } = await getCachedT212Positions(settings);
    t212Tickers = new Set(positions.map((p) => p.ticker.toUpperCase()));
  } catch {
    // T212 unreachable — skip reconciliation this cycle. Do NOT increment
    // miss counts on connection failures (would falsely close real positions).
    return closedThisCycle;
  }

  const ghostMissCount = loadGhostTracker();

  // Prune tracker entries for trades that are no longer open.
  const openTradeIds = new Set(openTrades.map((t) => t["id"] as string));
  for (const tradeId of ghostMissCount.keys()) {
    if (!openTradeIds.has(tradeId)) ghostMissCount.delete(tradeId);
  }

  for (const trade of openTrades) {
    const tradeId = trade["id"] as string;
    const ticker = (trade["ticker"] as string).toUpperCase();
    const presentInT212 = t212Tickers.has(ticker);

    if (presentInT212) {
      ghostMissCount.delete(tradeId);
      continue;
    }

    const newCount = (ghostMissCount.get(tradeId) ?? 0) + 1;
    ghostMissCount.set(tradeId, newCount);

    if (newCount >= 2) {
      // Confirmed ghost — auto-close in DB. Mirrors the close-route convention:
      // exitPrice = current trailing stop, rMultiple computed accordingly.
      const entryPrice = trade["entryPrice"] as number;
      const hardStop = trade["hardStop"] as number;
      const trailingStop = trade["trailingStop"] as number;
      const exitPrice = trailingStop;
      const riskPerShare = entryPrice - hardStop;
      const rMultiple = riskPerShare !== 0 ? (exitPrice - entryPrice) / riskPerShare : 0;

      try {
        await db.trade.update({
          where: { id: tradeId },
          data: {
            status: "CLOSED",
            exitDate: new Date(),
            exitPrice,
            exitReason: "GHOST_POSITION — T212 reconciliation",
            rMultiple,
          },
        } as unknown);
        ghostMissCount.delete(tradeId);
        closedThisCycle.add(tradeId);
      } catch {
        // Leave miss count in place; will retry next cycle.
      }
    }
  }

  saveGhostTracker(ghostMissCount);
  return closedThisCycle;
}

export interface AgentContext {
  timestamp: string;
  haltFlag: {
    halted: boolean;
    reason: string | null;
  };
  account: {
    equity: number;
    cash: number;
    snapshotAt: string;
  } | null;
  openPositions: Array<{
    id: number;
    ticker: string;
    entryPrice: number;
    currentStop: number;
    shares: number;
    sector: string | null;
    riskPct: number;
    unrealisedPnl: number | null;
    daysOpen: number;
    compositeGrade: string | null;
    daysStagnant: number;
    stopDistanceFromEntryPct: number;
    pnlR: number | null;
    initialStop: number | null;
  }>;
  pendingSignals: Array<{
    id: number;
    ticker: string;
    grade: string;
    compositeScore: number;
    entryPrice: number;
    stopPrice: number;
    stopDistancePct: number;
    riskPct: number;
    dollarRisk: number;
    suggestedShares: number;
    oneRTarget: number;
    twoRTarget: number;
    sector: string | null;
    engine: string;
    convergence: boolean;
    overdueMinutes: number;
  }>;
  riskBudget: {
    maxPositions: number;
    openPositions: number;
    slotsAvailable: number;
    heatCapPct: number;
    currentHeatPct: number;
    heatCapacityRemaining: number;
    regimeBullish: boolean;
  };
  settings: {
    autoExecutionEnabled: boolean;
    autoExecutionMinGrade: string;
    maxPositionsPerSector: number;
    drawdownState: string;
  };
  recentActivity: {
    lastCycleAt: string | null;
    ratchetsThisCycle: number;
  };
  timeStopFlags: Array<{
    id: number;
    tradeId: string;
    ticker: string;
    daysHeld: number;
    rMultiple: number;
    entryPrice: number;
    currentStop: number;
    flaggedAt: string;
  }>;
  consecutiveFailures: number;
  cycleId: string | null;
}

export async function gatherContext(cycleId: string | null = null): Promise<AgentContext> {
  // Load fresh DB settings before gathering context so the agent
  // always uses current config, not stale env-var defaults.
  await applyDbSettings();

  // Check consecutive Claude API failures from the persisted counter.
  // If we've failed 2+ times in a row, alert the user via Telegram and
  // surface the count to Claude so it can mention it in the summary.
  const consecutiveFailures = readFailureCount();
  if (consecutiveFailures >= 2) {
    try {
      await sendTelegram({
        text: `⚠️ Agent has failed ${consecutiveFailures} consecutive cycles — check logs`,
      });
    } catch {
      // non-fatal
    }
  }

  const now = new Date();

  const haltRow = await db.agentHaltFlag.findFirst();
  const halted: boolean = Boolean(haltRow?.halted);

  const snapshot = await db.accountSnapshot.findFirst({
    orderBy: { date: "desc" },
  } as unknown);

  const openTrades = await db.trade.findMany({
    where: { status: "OPEN" },
    orderBy: { entryDate: "asc" },
  } as unknown);

  // Ghost reconciliation: cross-check DB trades against live T212 positions.
  // Trades missing from T212 for 2+ consecutive cycles are auto-closed and
  // excluded from the agent's view this cycle. Cleared trades are silently
  // dropped — no Telegram noise for routine reconciliation.
  const ghostClosedIds = await reconcileGhostPositions(openTrades);
  const liveOpenTrades = openTrades.filter((t) => !ghostClosedIds.has(t["id"] as string));

  const equity = (snapshot?.balance as number) ?? 10000;

  const openPositions = await Promise.all(liveOpenTrades.map(async (t) => {
    const tradeId = t.id as string;
    const entryPrice = t.entryPrice as number;
    const trailingStop = t.trailingStop as number;
    const hardStop = t.hardStop as number;
    const shares = t.shares as number;
    const riskPct =
      (Math.abs(entryPrice - trailingStop) * shares) / equity * 100;
    const entryDate = t.entryDate as Date;
    const daysOpen = Math.floor(
      (now.getTime() - new Date(entryDate).getTime()) / 86400000
    );

    // Query stop history for this trade
    const stopHistory = await db.stopHistory.findMany({
      where: { tradeId },
      orderBy: { date: "desc" },
    } as unknown);

    // daysStagnant: days since the last stop change
    const lastChange = stopHistory.find((s) => s.changed === true);
    const lastChangeDate = lastChange ? new Date(lastChange.date as Date) : new Date(entryDate);
    const daysStagnant = Math.floor(
      (now.getTime() - lastChangeDate.getTime()) / 86400000
    );

    // initialStop: first stop history entry, or hardStop
    const firstStop = stopHistory.length > 0
      ? stopHistory[stopHistory.length - 1]
      : null;
    const initialStop = (firstStop?.stopLevel as number) ?? hardStop;

    // stopDistanceFromEntry: how far current stop is from entry
    const stopDistanceFromEntryPct = entryPrice > 0
      ? Math.round(((entryPrice - trailingStop) / entryPrice) * 10000) / 100
      : 0;

    // pnlR: unrealised P&L in R-multiples
    const initialRisk = entryPrice - initialStop;
    const pnlR = initialRisk > 0
      ? Math.round(((trailingStop - entryPrice) / initialRisk) * 100) / 100
      : null;

    return {
      id: t.id as number,
      ticker: t.ticker as string,
      entryPrice,
      currentStop: trailingStop,
      shares,
      sector: (t.sector as string) ?? null,
      riskPct: Math.round(riskPct * 100) / 100,
      unrealisedPnl: null,
      daysOpen,
      compositeGrade: (t.signalGrade as string) ?? null,
      daysStagnant,
      stopDistanceFromEntryPct,
      pnlR,
      initialStop,
    };
  }));

  // Agent runs hourly; a strict cancelDeadline filter can hide legitimate
  // pending signals between cycles. Include recent overdue orders so the
  // agent can still decide whether to execute them this cycle.
  const pendingGraceCutoff = new Date(now.getTime() - 6 * 60 * 60_000);
  const pending = await db.pendingOrder.findMany({
    where: {
      status: "pending",
      OR: [
        { cancelDeadline: { gt: now } },
        { cancelDeadline: { lte: now }, createdAt: { gte: pendingGraceCutoff } },
      ],
    },
    orderBy: [{ compositeScore: "desc" }, { createdAt: "desc" }],
    // Top 5 only — agent needs to pick 1-2 slots, not evaluate 100 options.
    take: 5,
  } as unknown);

  const tickerEngineMap = new Map<string, string[]>();
  for (const p of pending) {
    const sym = p.ticker as string;
    const engine = (p.signalSource as string) ?? "volume";
    if (!tickerEngineMap.has(sym)) tickerEngineMap.set(sym, []);
    tickerEngineMap.get(sym)!.push(engine);
  }

  const pendingSignals = pending.map((p) => {
    const sym = p.ticker as string;
    const engines = tickerEngineMap.get(sym) ?? [];
    const entry = p.suggestedEntry as number;
    const stop = p.suggestedStop as number;
    const stopDistance = Math.abs(entry - stop);
    const risk = entry > 0 ? stopDistance / entry * 100 : 1;
    const dollarRisk = (p.dollarRisk as number) ?? 0;
    const shares = (p.suggestedShares as number) ?? 0;
    const cancelDeadline = new Date(p.cancelDeadline as Date);
    const overdueMinutes = Math.max(
      0,
      Math.round((now.getTime() - cancelDeadline.getTime()) / 60_000),
    );
    return {
      id: p.id as number,
      ticker: sym,
      grade: (p.signalGrade as string) ?? "C",
      compositeScore: (p.compositeScore as number) ?? 0,
      entryPrice: entry,
      stopPrice: stop,
      stopDistancePct: Math.round(risk * 100) / 100,
      riskPct: Math.round(risk * 100) / 100,
      dollarRisk: Math.round(dollarRisk * 100) / 100,
      suggestedShares: shares,
      oneRTarget: Math.round((entry + stopDistance) * 100) / 100,
      twoRTarget: Math.round((entry + stopDistance * 2) * 100) / 100,
      sector: (p.sector as string) ?? null,
      engine: (p.signalSource as string) ?? "volume",
      convergence: engines.length > 1,
      overdueMinutes,
    };
  });

  const appSettings = await db.appSettings.findFirst();
  const settings = {
    autoExecutionEnabled: (appSettings?.autoExecutionEnabled as boolean) ?? false,
    autoExecutionMinGrade: (appSettings?.autoExecutionMinGrade as string) ?? "B",
    maxPositionsPerSector: (appSettings?.maxPositionsPerSector as number) ?? 2,
    drawdownState: "NORMAL" as string, // computed by equityCurve at execution time
  };

  const heatCapPct = parseFloat(process.env["HEAT_CAP_PCT"] ?? "0.08");
  const currentHeatPct =
    openPositions.reduce((sum, p) => sum + p.riskPct, 0) / 100;
  const maxPositions = parseInt(process.env["MAX_POSITIONS"] ?? "4", 10);

  // Fetch live regime from QQQ 200-day MA — fail-safe to bearish (no new entries)
  let regimeBullish = false;
  try {
    const regime = await calculateMarketRegime();
    regimeBullish = regime.marketRegime === "BULLISH";
  } catch {
    // Yahoo down or network error — default to bearish (conservative)
  }

  const riskBudget = {
    maxPositions,
    openPositions: openPositions.length,
    slotsAvailable: Math.max(0, maxPositions - openPositions.length),
    heatCapPct: heatCapPct * 100,
    currentHeatPct: Math.round(currentHeatPct * 10000) / 100,
    heatCapacityRemaining: Math.round(
      Math.max(0, heatCapPct - currentHeatPct) * 10000
    ) / 100,
    regimeBullish,
  };

  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const recentRatchets = await db.cruiseControlRatchetEvent.findMany({
    where: { createdAt: { gte: oneHourAgo } },
  } as unknown);

  const lastCycleLog = await db.agentDecisionLog.findFirst({
    orderBy: { createdAt: "desc" },
  } as unknown);

  const activeTimeStopFlags = await db.timeStopFlag.findMany({
    where: { dismissed: false },
    orderBy: { flaggedAt: "desc" },
  } as unknown);

  return {
    timestamp: now.toISOString(),
    haltFlag: { halted, reason: (haltRow?.reason as string) ?? null },
    account: snapshot
      ? {
          equity: snapshot.balance as number,
          cash: 0,
          snapshotAt: (snapshot.date as Date).toISOString(),
        }
      : null,
    openPositions,
    pendingSignals,
    riskBudget,
    settings,
    recentActivity: {
      lastCycleAt: lastCycleLog ? (lastCycleLog.createdAt as Date).toISOString() : null,
      ratchetsThisCycle: recentRatchets.length,
    },
    timeStopFlags: activeTimeStopFlags.map((f) => ({
      id: f["id"] as number,
      tradeId: f["tradeId"] as string,
      ticker: f["ticker"] as string,
      daysHeld: f["daysHeld"] as number,
      rMultiple: f["rMultiple"] as number,
      entryPrice: f["entryPrice"] as number,
      currentStop: f["currentStop"] as number,
      flaggedAt: (f["flaggedAt"] as Date).toISOString(),
    })),
    consecutiveFailures,
    cycleId,
  };
}
