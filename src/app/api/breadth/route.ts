import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { calculateBreadth } from "@/lib/signals/breadthIndicator";
import { getUniverse } from "@/lib/universe/tickers";

export const dynamic = "force-dynamic";

const db = prisma as unknown as {
  scanRun: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: number;
        startedAt: Date;
        breadthScore: number | null;
        breadthSignal: string | null;
        breadthTrend: string | null;
        above50MAPct: number | null;
        above200MAPct: number | null;
        newHighLowRatio: number | null;
        advanceDeclinePct: number | null;
      }>
    >;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  try {
    const url = new URL(req.url);
    const rawHistory = Number(url.searchParams.get("history") ?? "30");
    const historyCount = Number.isFinite(rawHistory) && rawHistory > 0 && Number.isInteger(rawHistory)
      ? Math.min(rawHistory, 180)
      : 20;

    // Get historical breadth from ScanRun records
    const runs = await db.scanRun.findMany({
      where: { breadthScore: { not: null } },
      orderBy: { startedAt: "desc" },
      take: historyCount,
      select: {
        id: true,
        startedAt: true,
        breadthScore: true,
        breadthSignal: true,
        breadthTrend: true,
        above50MAPct: true,
        above200MAPct: true,
        newHighLowRatio: true,
        advanceDeclinePct: true,
      },
    });

    // Try to compute current live breadth from cache
    let current = null;
    try {
      current = await calculateBreadth(getUniverse());
    } catch {
      // Fall back to latest stored breadth
    }

    // If no current breadth, use the most recent stored value
    const latestRun = runs[0];
    if (!current && latestRun) {
      current = {
        above50MA: latestRun.above50MAPct ?? 0,
        above200MA: latestRun.above200MAPct ?? 0,
        above50MA_count: 0,
        above200MA_count: 0,
        totalMeasured: 0,
        newHighs: 0,
        newLows: 0,
        newHighLowRatio: latestRun.newHighLowRatio ?? 0,
        advanceDecline: latestRun.advanceDeclinePct ?? 0,
        breadthScore: latestRun.breadthScore ?? 0,
        breadthSignal: latestRun.breadthSignal ?? "NEUTRAL",
        breadthTrend: latestRun.breadthTrend ?? "STABLE",
        warning: null,
      };
    }

    // Build history array (oldest first)
    const history = runs.reverse().map((r) => ({
      date: r.startedAt.toISOString(),
      score: r.breadthScore,
      signal: r.breadthSignal,
      above50MA: r.above50MAPct,
      above200MA: r.above200MAPct,
    }));

    return NextResponse.json({
      current,
      history,
      scanRunId: latestRun?.id ?? null,
      runAt: latestRun?.startedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load breadth data" },
      { status: 500 },
    );
  }
}
