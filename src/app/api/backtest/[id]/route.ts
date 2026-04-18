import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const db = prisma as unknown as {
  backtestRun: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  backtestTrade: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
};

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const run = await db.backtestRun.findUnique({ where: { id: numId } });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const trades = await db.backtestTrade.findMany({
    where: { runId: numId },
    orderBy: { entryDate: "asc" },
  });

  // Serialise dates and BigInts safely
  const serialise = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v instanceof Date) out[k] = v.toISOString();
      else if (typeof v === "bigint") out[k] = Number(v);
      else out[k] = v;
    }
    return out;
  };

  return NextResponse.json({
    run: serialise(run),
    trades: trades.map(serialise),
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(getRateLimitKey(req), 10, 60_000);
  if (limited) return limited;

  const { id } = await ctx.params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const dbDel = prisma as unknown as {
    backtestRun: { delete: (args: unknown) => Promise<unknown> };
  };

  try {
    // BacktestTrade has onDelete: Cascade so child rows go automatically.
    await dbDel.backtestRun.delete({ where: { id: numId } });
    return NextResponse.json({ deleted: numId });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
