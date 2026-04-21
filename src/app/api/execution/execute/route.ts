import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import {
  processPendingOrder,
  type PendingOrderRow,
} from "@/lib/execution/autoExecutor";

const db = prisma as unknown as {
  pendingOrder: {
    findUnique: (args: unknown) => Promise<PendingOrderRow | null>;
    findMany: (args: unknown) => Promise<Array<{ signalSource: string }>>;
  };
  trade: {
    findUnique: (args: unknown) => Promise<{ id: string; signalSource: string } | null>;
    findMany: (args: unknown) => Promise<Array<{ id: string; ticker: string; signalSource: string; entryPrice: number; shares: number; hardStop: number; trailingStop: number }>>;
    count: (args: unknown) => Promise<number>;
  };
  accountSnapshot: {
    findFirst: (args: unknown) => Promise<{ balance: number } | null>;
  };
};

/**
 * POST /api/execution/execute
 * Executes a specific PendingOrder through the full pre-flight + T212 flow.
 * Used by the autonomous agent to trigger order execution.
 *
 * Hard execution caps (when cycleId is provided):
 *   1. Max 2 successful executions per cycleId
 *   2. The 2nd execution requires BOTH the prior trade AND this order to be
 *      convergence signals (volume + momentum agreement on the same ticker)
 *   3. Adding this position must not push portfolio heat above HEAT_CAP_PCT
 *
 * These caps are enforced in code so a hallucinating Claude cannot exceed
 * the prompt-level rules. If cycleId is absent (manual / scheduler exec),
 * the caps are skipped and execution proceeds straight to pre-flight.
 */
export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const pendingOrderId = body["pendingOrderId"];
    const rawCycleId = body["cycleId"];
    const cycleId = typeof rawCycleId === "string" && rawCycleId.length > 0 ? rawCycleId : null;

    if (typeof pendingOrderId !== "number") {
      return NextResponse.json(
        { error: "pendingOrderId (number) is required" },
        { status: 400 },
      );
    }

    const order = await db.pendingOrder.findUnique({
      where: { id: pendingOrderId },
    } as unknown);

    if (!order) {
      return NextResponse.json(
        { error: `PendingOrder ${pendingOrderId} not found` },
        { status: 404 },
      );
    }

    if (order.status !== "pending") {
      return NextResponse.json(
        { error: `Order status is '${order.status}', not 'pending'` },
        { status: 409 },
      );
    }

    // ── Hard execution cap (cycle-scoped) ────────────────────────────────
    // Only enforced when cycleId is supplied. Manual / scheduler executions
    // bypass these caps because they don't share a cycle.
    if (cycleId) {
      // (1) Count prior successful executions in this cycle.
      const priorCount = await db.trade.count({ where: { cycleId } } as unknown);

      if (priorCount >= 2) {
        return NextResponse.json(
          { error: `EXECUTION_CAP — already executed ${priorCount} signals in cycle ${cycleId}. Hard cap is 2 per cycle.` },
          { status: 429 },
        );
      }

      // (2) If this is the 2nd execution, BOTH must be convergence signals.
      //     Convergence = the same ticker had pending orders from >1 distinct
      //     signal engines at scan time. Match the same derivation used by the
      //     agent context so the API and the prompt agree on what "convergence"
      //     means.
      if (priorCount === 1) {
        const newConv = await isConvergenceSignal(order.ticker);
        if (!newConv) {
          return NextResponse.json(
            { error: `EXECUTION_CAP — second signal in cycle must be convergence (volume+momentum). ${order.ticker} is single-engine (${order.signalSource}).` },
            { status: 429 },
          );
        }

        // Verify the previously-executed trade in this cycle was also convergence.
        // We query Trades tagged with this cycleId and check by ticker.
        const priorTrades = await db.trade.findMany({
          where: { cycleId },
          orderBy: { entryDate: "asc" },
        } as unknown);
        for (const pt of priorTrades) {
          const priorConv = await isConvergenceSignal(pt.ticker);
          if (!priorConv) {
            return NextResponse.json(
              { error: `EXECUTION_CAP — prior cycle trade ${pt.ticker} (${pt.signalSource}) was not convergence. Second execution disallowed.` },
              { status: 429 },
            );
          }
        }
      }

      // (3) Heat-cap check at the API layer (belt-and-braces vs pre-flight #13).
      //     Uses the same HEAT_CAP_PCT env var and latest account snapshot.
      const heatCapEnv = process.env["HEAT_CAP_PCT"];
      const heatCapPct = heatCapEnv ? parseFloat(heatCapEnv) : NaN;
      if (Number.isFinite(heatCapPct) && heatCapPct > 0 && heatCapPct <= 0.5) {
        const snapshot = await db.accountSnapshot.findFirst({
          orderBy: { snapshotAt: "desc" },
        } as unknown);
        if (snapshot && snapshot.balance > 0) {
          const openTrades = await db.trade.findMany({
            where: { status: "OPEN" },
          } as unknown);
          const openRiskGbp = openTrades.reduce((sum, t) => {
            const stop = Math.max(t.hardStop, t.trailingStop);
            const risk = Math.max(0, t.entryPrice - stop) * t.shares;
            return sum + risk;
          }, 0);
          const newRiskGbp = order.dollarRisk;
          const totalRiskPct = (openRiskGbp + newRiskGbp) / snapshot.balance;
          if (totalRiskPct > heatCapPct) {
            return NextResponse.json(
              {
                error: `EXECUTION_CAP — heat ${(totalRiskPct * 100).toFixed(2)}% exceeds cap ${(heatCapPct * 100).toFixed(1)}% (open ${(openRiskGbp / snapshot.balance * 100).toFixed(2)}% + new ${(newRiskGbp / snapshot.balance * 100).toFixed(2)}%).`,
              },
              { status: 429 },
            );
          }
        }
      }
    }

    await processPendingOrder(order, cycleId);

    // Re-fetch to get updated status after processing
    const updated = await db.pendingOrder.findUnique({
      where: { id: pendingOrderId },
    } as unknown);

    return NextResponse.json({
      ok: true,
      orderId: pendingOrderId,
      status: updated?.status ?? "unknown",
      cycleId,
      agentReasoning: body["agentReasoning"] ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

/**
 * Returns true if the given ticker has pending orders from more than one
 * distinct signal engine (e.g. volume + momentum). Mirrors the convergence
 * derivation in src/agent/context.ts so the API and the agent's view agree.
 */
async function isConvergenceSignal(ticker: string): Promise<boolean> {
  const rows = await db.pendingOrder.findMany({
    where: { ticker },
    select: { signalSource: true },
  } as unknown);
  const distinct = new Set(rows.map((r) => r.signalSource));
  return distinct.size > 1;
}
