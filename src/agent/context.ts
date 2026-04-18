import { prisma } from "@/db/client";

const db = prisma as unknown as {
  trade: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
  pendingOrder: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
  accountSnapshot: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
  appSettings: { findFirst: () => Promise<Record<string, unknown> | null> };
  agentHaltFlag: { findFirst: () => Promise<Record<string, unknown> | null> };
  agentDecisionLog: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
  cruiseControlRatchetEvent: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
  stopHistory: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
};

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
}

export async function gatherContext(): Promise<AgentContext> {
  const now = new Date();

  const haltRow = await db.agentHaltFlag.findFirst();
  const halted = haltRow?.halted ?? false;

  const snapshot = await db.accountSnapshot.findFirst({
    orderBy: { date: "desc" },
  } as unknown);

  const openTrades = await db.trade.findMany({
    where: { status: "OPEN" },
    orderBy: { entryDate: "asc" },
  } as unknown);

  const equity = (snapshot?.balance as number) ?? 10000;

  const openPositions = await Promise.all(openTrades.map(async (t) => {
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

  const pending = await db.pendingOrder.findMany({
    where: { status: "pending", cancelDeadline: { gt: now } },
    orderBy: { compositeScore: "desc" },
    take: 20,
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
  // Regime is calculated live by regimeFilter — default true, executor re-checks at execution
  const regimeBullish = true;

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
  };
}
