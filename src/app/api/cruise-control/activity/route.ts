import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { prisma } from "@/db/client";

const db = prisma as unknown as {
  cruiseControlRatchetEvent: {
    findMany: (args: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, string>;
      take?: number;
    }) => Promise<Array<{
      id: number;
      positionType: string;
      positionId: string;
      ticker: string;
      pollTimestamp: Date;
      oldStop: number;
      newStop: number;
      ratchetPct: number;
      currentPrice: number;
      profitPct: number;
      atrUsed: number;
      t212Updated: boolean;
      createdAt: Date;
    }>>;
  };
};

export async function GET(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const hoursParam = req.nextUrl.searchParams.get("hours");
  const hours = hoursParam ? parseInt(hoursParam, 10) : 24;

  const since = new Date();
  since.setHours(since.getHours() - hours);

  const events = await db.cruiseControlRatchetEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(events);
}
