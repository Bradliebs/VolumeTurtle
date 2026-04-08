import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/trades/runner");

const db = prisma as unknown as {
  trade: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      ticker: string;
      entryPrice: number;
      isRunner: boolean;
      runnerActivatedAt: Date | null;
      runnerPeakProfit: number | null;
      status: string;
    } | null>;
    findUnique: (args: unknown) => Promise<{
      id: string;
      ticker: string;
      isRunner: boolean;
      status: string;
    } | null>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  try {
    const runner = await db.trade.findFirst({
      where: { isRunner: true, status: "OPEN" },
    });

    if (!runner) {
      return NextResponse.json({
        runner: null,
        slotAvailable: true,
        activatedAt: null,
        peakProfit: null,
        phase: "none",
      });
    }

    const phase = runner.runnerActivatedAt ? "active" : "waiting";

    return NextResponse.json({
      runner,
      slotAvailable: false,
      activatedAt: runner.runnerActivatedAt?.toISOString() ?? null,
      peakProfit: runner.runnerPeakProfit,
      phase,
    });
  } catch (err) {
    log.error({ err }, "Failed to get runner");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 10, 60_000);
  if (limited) return limited;

  try {
    const body = await req.json();
    const { tradeId, isRunner } = body as { tradeId: string; isRunner: boolean };

    if (!tradeId || typeof isRunner !== "boolean") {
      return NextResponse.json(
        { error: "tradeId and isRunner (boolean) required" },
        { status: 400 },
      );
    }

    const trade = await db.trade.findUnique({ where: { id: tradeId } });
    if (!trade) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }
    if (trade.status !== "OPEN") {
      return NextResponse.json({ error: "Trade is not open" }, { status: 400 });
    }

    // If designating a new runner, check slot availability
    if (isRunner) {
      const existing = await db.trade.findFirst({
        where: { isRunner: true, status: "OPEN" },
      });
      if (existing && existing.id !== tradeId) {
        return NextResponse.json(
          { error: `Runner slot occupied by ${existing.ticker}. Remove it first.` },
          { status: 409 },
        );
      }
    }

    await db.trade.update({
      where: { id: tradeId },
      data: {
        isRunner,
        // Reset activation tracking if removing runner status
        ...(!isRunner
          ? { runnerActivatedAt: null, runnerPeakProfit: null }
          : {}),
      },
    });

    log.info({ tradeId, ticker: trade.ticker, isRunner }, "Runner status updated");

    return NextResponse.json({ success: true, ticker: trade.ticker, isRunner });
  } catch (err) {
    log.error({ err }, "Failed to update runner");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}
