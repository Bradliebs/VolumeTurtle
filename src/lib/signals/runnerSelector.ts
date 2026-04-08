/**
 * Runner Selector — determines which trade should be designated as the runner.
 *
 * Rules:
 * 1. Maximum one runner active at any time
 * 2. Runner candidate priority:
 *    a. Convergence signal (flagged by BOTH volume and momentum engines same day)
 *    b. Grade A composite score (>= 0.75)
 *    c. Grade B composite score (>= 0.55), only if no Grade A exists
 * 3. Tiebreaker: highest compositeScore
 * 4. Designation happens at trade ENTRY, not after the fact
 */

import { prisma } from "@/db/client";
import { createLogger } from "@/lib/logger";

const log = createLogger("runnerSelector");

interface TradeCandidate {
  id: string;
  ticker: string;
  entryDate: Date;
  signalScore: number | null;
  signalGrade: string | null;
  signalSource: string;
  isRunner: boolean;
  status: string;
}

const db = prisma as unknown as {
  trade: {
    findFirst: (args: unknown) => Promise<TradeCandidate | null>;
    findMany: (args: unknown) => Promise<TradeCandidate[]>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  scanResult: {
    findFirst: (args: unknown) => Promise<{ id: string; ticker: string } | null>;
  };
  momentumSignal: {
    findFirst: (args: unknown) => Promise<{ id: number; ticker: string } | null>;
  };
  appSettings: {
    findFirst: (args?: unknown) => Promise<{ runnerEnabled: boolean } | null>;
  };
};

/**
 * Check if the runner slot is available (no open trade currently designated as runner).
 */
export async function isRunnerSlotAvailable(): Promise<boolean> {
  const existing = await db.trade.findFirst({
    where: { isRunner: true, status: "OPEN" },
  });
  return existing == null;
}

/**
 * Get the current open runner position, or null.
 */
export async function getCurrentRunner(): Promise<TradeCandidate | null> {
  return db.trade.findFirst({
    where: { isRunner: true, status: "OPEN" },
  });
}

/**
 * Check if a ticker was flagged by both volume and momentum engines on the same day.
 */
async function isConvergenceSignal(ticker: string, entryDate: Date): Promise<boolean> {
  const dayStart = new Date(entryDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(entryDate);
  dayEnd.setHours(23, 59, 59, 999);

  const [volumeHit, momentumHit] = await Promise.all([
    db.scanResult.findFirst({
      where: {
        ticker,
        signalFired: true,
        scanDate: { gte: dayStart, lte: dayEnd },
      },
    }),
    db.momentumSignal.findFirst({
      where: {
        ticker,
        createdAt: { gte: dayStart, lte: dayEnd },
        status: "active",
      },
    }),
  ]);

  return volumeHit != null && momentumHit != null;
}

/**
 * Attempt to designate a trade as the runner.
 * Returns true if the trade was designated, false otherwise.
 *
 * Call this at trade entry time with the newly created trade.
 */
export async function designateRunner(trade: TradeCandidate): Promise<boolean> {
  // Check if runner feature is enabled
  const settings = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
  if (settings && !settings.runnerEnabled) {
    return false;
  }

  // Check if slot is available
  const slotOpen = await isRunnerSlotAvailable();
  if (!slotOpen) {
    log.info({ ticker: trade.ticker }, "Runner slot occupied — skipping designation");
    return false;
  }

  // Priority a: Convergence signal (both engines fired same day)
  const convergence = await isConvergenceSignal(trade.ticker, trade.entryDate);
  if (convergence) {
    await db.trade.update({
      where: { id: trade.id },
      data: { isRunner: true },
    });
    log.info({ ticker: trade.ticker }, "Runner designated: convergence signal (volume + momentum)");
    return true;
  }

  // Priority b: Grade A (compositeScore >= 0.75)
  const score = trade.signalScore ?? 0;
  if (score >= 0.75) {
    await db.trade.update({
      where: { id: trade.id },
      data: { isRunner: true },
    });
    log.info({ ticker: trade.ticker, score }, "Runner designated: Grade A signal");
    return true;
  }

  // Priority c: Grade B (compositeScore >= 0.55), only if no Grade A exists among today's entries
  if (score >= 0.55) {
    // Check if any other trade entered today has Grade A — if so, that one should be runner, not this one
    const dayStart = new Date(trade.entryDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(trade.entryDate);
    dayEnd.setHours(23, 59, 59, 999);

    const gradeATrades = await db.trade.findMany({
      where: {
        entryDate: { gte: dayStart, lte: dayEnd },
        status: "OPEN",
        signalScore: { gte: 0.75 },
      },
    });

    if (gradeATrades.length === 0) {
      await db.trade.update({
        where: { id: trade.id },
        data: { isRunner: true },
      });
      log.info({ ticker: trade.ticker, score }, "Runner designated: Grade B signal (no Grade A available)");
      return true;
    }
  }

  return false;
}
