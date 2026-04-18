import { NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { snapshotUniverse } from "@/lib/backtest";
import { prisma } from "@/db/client";

const db = prisma as unknown as {
  universeSnapshot: {
    groupBy: (args: unknown) => Promise<Array<{
      snapshotDate: Date;
      _count: { ticker: number };
    }>>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const rows = await db.universeSnapshot.groupBy({
    by: ["snapshotDate"],
    _count: { ticker: true },
    orderBy: { snapshotDate: "desc" },
    take: 60,
  });

  return NextResponse.json({
    snapshots: rows.map((r) => ({
      date: r.snapshotDate.toISOString().slice(0, 10),
      tickerCount: r._count.ticker,
    })),
  });
}

export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  try {
    const count = await snapshotUniverse();
    return NextResponse.json({
      date: new Date().toISOString().slice(0, 10),
      tickerCount: count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
