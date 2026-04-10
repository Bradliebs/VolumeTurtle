import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

interface ExecutionLogRow {
  id: number;
  orderId: number;
  event: string;
  detail: string;
  createdAt: Date;
}

const db = prisma as unknown as {
  executionLog: {
    findMany: (args: unknown) => Promise<ExecutionLogRow[]>;
  };
};

/**
 * GET /api/execution/log
 * Returns the last 50 execution log entries.
 */
export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const logs = await db.executionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ logs });
}
