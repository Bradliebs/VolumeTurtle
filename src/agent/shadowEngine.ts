// Shadow rules engine — deterministic baseline for agent decision validation.
//
// Takes the same AgentContext the LLM sees and produces a structured verdict
// about what a purely mechanical system would do. Runs every cycle alongside
// the agent. Divergences between the agent's actual actions and the shadow's
// expected actions are logged and alerted via Telegram.
//
// This is NOT a replacement for the agent — it's a control sample. The agent
// can deviate for good reasons (pre-market risk, catalyst-driven skip, etc.),
// but every deviation is now visible and auditable.

import type { AgentContext } from "./context";
import type { CycleAction } from "./logger";

// ── Types ─────────────────────────────────────────────────────────

export interface ShadowVerdict {
  shouldBlock: boolean;
  blockReason: string | null;
  /** Signals the shadow would execute (sorted best-first). */
  shouldExecute: ShadowSignal[];
  /** Signals the shadow would skip, with reason. */
  shouldSkip: ShadowSkip[];
  /** Max executions allowed this cycle. */
  maxExecutions: number;
}

interface ShadowSignal {
  id: number;
  ticker: string;
  grade: string;
  compositeScore: number;
  convergence: boolean;
}

interface ShadowSkip {
  id: number;
  ticker: string;
  reason: string;
}

export interface ShadowDivergence {
  type: "EXECUTED_UNEXPECTED" | "SKIPPED_EXPECTED" | "EXECUTED_BLOCKED";
  ticker: string;
  detail: string;
}

export interface ShadowReport {
  verdict: ShadowVerdict;
  divergences: ShadowDivergence[];
  aligned: boolean;
  promptVersion: string;
}

// ── Grade ordering ────────────────────────────────────────────────

const GRADE_RANK: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 };

function gradeRank(grade: string): number {
  return GRADE_RANK[grade.toUpperCase()] ?? 0;
}

function meetsMinGrade(grade: string, minGrade: string): boolean {
  return gradeRank(grade) >= gradeRank(minGrade);
}

// ── Shadow engine ─────────────────────────────────────────────────

export function computeShadowVerdict(ctx: AgentContext): ShadowVerdict {
  // 1. Global blockers — same as prompt HARD CONSTRAINTS
  if (ctx.haltFlag.halted) {
    return blocked("HALT flag active");
  }
  if (!ctx.riskBudget.regimeBullish) {
    return blocked("Regime BEARISH — no new entries");
  }
  if (ctx.settings.drawdownState === "PAUSE") {
    return blocked("Drawdown PAUSE — no new entries");
  }
  if (ctx.riskBudget.heatCapacityRemaining < 1.0) {
    return blocked("Heat cap exhausted");
  }
  if (ctx.riskBudget.slotsAvailable <= 0) {
    return blocked("No position slots available");
  }

  // 2. Filter and rank pending signals
  const minGrade = ctx.settings.autoExecutionMinGrade || "B";
  const shouldExecute: ShadowSignal[] = [];
  const shouldSkip: ShadowSkip[] = [];

  // Tickers already held
  const heldTickers = new Set(ctx.openPositions.map((p) => p.ticker));

  // Sector counts
  const sectorCounts = new Map<string, number>();
  for (const p of ctx.openPositions) {
    if (p.sector) {
      sectorCounts.set(p.sector, (sectorCounts.get(p.sector) ?? 0) + 1);
    }
  }

  for (const signal of ctx.pendingSignals) {
    // Already held
    if (heldTickers.has(signal.ticker)) {
      shouldSkip.push({ id: signal.id, ticker: signal.ticker, reason: "Already held" });
      continue;
    }

    // Grade check
    if (!meetsMinGrade(signal.grade, minGrade)) {
      shouldSkip.push({
        id: signal.id,
        ticker: signal.ticker,
        reason: `Grade ${signal.grade} below minimum ${minGrade}`,
      });
      continue;
    }

    // Sector concentration
    if (signal.sector) {
      const sectorCount = sectorCounts.get(signal.sector) ?? 0;
      if (sectorCount >= ctx.settings.maxPositionsPerSector) {
        shouldSkip.push({
          id: signal.id,
          ticker: signal.ticker,
          reason: `Sector ${signal.sector} at cap (${sectorCount}/${ctx.settings.maxPositionsPerSector})`,
        });
        continue;
      }
    }

    shouldExecute.push({
      id: signal.id,
      ticker: signal.ticker,
      grade: signal.grade,
      compositeScore: signal.compositeScore,
      convergence: signal.convergence,
    });
  }

  // Sort: convergence first, then by grade rank desc, then compositeScore desc
  shouldExecute.sort((a, b) => {
    if (a.convergence !== b.convergence) return a.convergence ? -1 : 1;
    const gradeA = gradeRank(a.grade);
    const gradeB = gradeRank(b.grade);
    if (gradeA !== gradeB) return gradeB - gradeA;
    return b.compositeScore - a.compositeScore;
  });

  // Execution cap: 2 if both top signals are convergence, else 1
  const topTwo = shouldExecute.slice(0, 2);
  const maxExecutions =
    topTwo.length >= 2 && topTwo[0]!.convergence && topTwo[1]!.convergence
      ? 2
      : 1;

  return {
    shouldBlock: false,
    blockReason: null,
    shouldExecute,
    shouldSkip,
    maxExecutions,
  };
}

function blocked(reason: string): ShadowVerdict {
  return {
    shouldBlock: true,
    blockReason: reason,
    shouldExecute: [],
    shouldSkip: [],
    maxExecutions: 0,
  };
}

// ── Divergence detection ──────────────────────────────────────────

/**
 * Compare the agent's actual tool calls against the shadow verdict.
 * Returns a list of divergences (may be empty = aligned).
 */
export function detectDivergences(
  verdict: ShadowVerdict,
  actions: CycleAction[],
): ShadowDivergence[] {
  const divergences: ShadowDivergence[] = [];

  // Extract tickers the agent actually executed
  const executedTickers = new Set<string>();
  for (const action of actions) {
    if (action.toolName === "execute_signal" && action.result.success) {
      const ticker =
        (action.toolInput["ticker"] as string | undefined) ??
        (action.toolInput["pendingOrderId"] != null ? tickerFromResult(action) : null);
      if (ticker) executedTickers.add(ticker);
    }
  }

  // 1. Agent executed while shadow says BLOCKED
  if (verdict.shouldBlock && executedTickers.size > 0) {
    for (const ticker of executedTickers) {
      divergences.push({
        type: "EXECUTED_BLOCKED",
        ticker,
        detail: `Agent executed ${ticker} but shadow blocked: ${verdict.blockReason}`,
      });
    }
    return divergences;
  }

  // 2. Agent executed a ticker the shadow would skip
  const skipTickers = new Set(verdict.shouldSkip.map((s) => s.ticker));
  for (const ticker of executedTickers) {
    if (skipTickers.has(ticker)) {
      const skip = verdict.shouldSkip.find((s) => s.ticker === ticker);
      divergences.push({
        type: "EXECUTED_UNEXPECTED",
        ticker,
        detail: `Agent executed ${ticker} but shadow would skip: ${skip?.reason ?? "unknown"}`,
      });
    }
  }

  // 3. Shadow would execute but agent didn't
  //    Only flag the top N (up to maxExecutions) — the agent isn't expected
  //    to execute every possible signal, just the best ones.
  const expectedTickers = verdict.shouldExecute
    .slice(0, verdict.maxExecutions)
    .map((s) => s.ticker);
  for (const ticker of expectedTickers) {
    if (!executedTickers.has(ticker) && !verdict.shouldBlock) {
      divergences.push({
        type: "SKIPPED_EXPECTED",
        ticker,
        detail: `Shadow expected ${ticker} to be executed but agent skipped it`,
      });
    }
  }

  return divergences;
}

function tickerFromResult(action: CycleAction): string | null {
  const data = action.result.data as Record<string, unknown> | undefined;
  if (data && typeof data["ticker"] === "string") return data["ticker"];
  return null;
}
