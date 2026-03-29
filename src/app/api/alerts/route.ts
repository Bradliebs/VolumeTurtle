import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { runAlertCheck } from "@/lib/hbme/alertEngine";

const db = prisma as unknown as {
  alert: {
    findMany: (args: unknown) => Promise<Array<{
      id: number;
      type: string;
      ticker: string;
      message: string;
      severity: string;
      price: number | null;
      stopPrice: number | null;
      signalSource: string | null;
      acknowledged: boolean;
      sentTelegram: boolean;
      createdAt: Date;
    }>>;
    count: (args: unknown) => Promise<number>;
    update: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const alerts = await db.alert.findMany({
    where: { acknowledged: false },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const criticalCount = await db.alert.count({
    where: { acknowledged: false, severity: "critical" },
  });

  return NextResponse.json({ alerts, criticalCount });
}

export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  const alerts = await runAlertCheck();
  return NextResponse.json({ fired: alerts.length });
}

export async function PATCH(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const body = await req.json();
  const { id, all } = body as { id?: number; all?: boolean };

  if (all) {
    const result = await db.alert.updateMany({
      where: { acknowledged: false },
      data: { acknowledged: true },
    });
    return NextResponse.json({ acknowledged: result.count });
  }

  if (id != null) {
    await db.alert.update({
      where: { id },
      data: { acknowledged: true },
    });
    return NextResponse.json({ acknowledged: 1 });
  }

  return NextResponse.json({ error: "Provide id or all:true" }, { status: 400 });
}
