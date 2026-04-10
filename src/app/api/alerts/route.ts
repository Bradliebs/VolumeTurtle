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
    findUnique: (args: { where: { id: number } }) => Promise<{
      id: number;
      type: string;
      ticker: string;
    } | null>;
    count: (args: unknown) => Promise<number>;
    update: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  trade: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      stopPushedAt: Date | null;
    } | null>;
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
    // When acknowledging all, skip STOP_PUSH_FAILED alerts where stop is still unconfirmed
    const stopAlerts = await db.alert.findMany({
      where: { acknowledged: false, type: "STOP_PUSH_FAILED" },
    });
    const blockedIds: number[] = [];
    for (const alert of stopAlerts) {
      const trade = await db.trade.findFirst({
        where: { ticker: alert.ticker, status: "OPEN", stopPushedAt: null },
      });
      if (trade) blockedIds.push(alert.id);
    }

    const result = await db.alert.updateMany({
      where: {
        acknowledged: false,
        ...(blockedIds.length > 0 ? { id: { notIn: blockedIds } } : {}),
      },
      data: { acknowledged: true },
    });

    return NextResponse.json({
      acknowledged: result.count,
      ...(blockedIds.length > 0
        ? { blocked: blockedIds.length, reason: "STOP_PUSH_FAILED alerts cannot be acknowledged while stop is unconfirmed" }
        : {}),
    });
  }

  if (id != null) {
    // Guard: prevent acknowledging STOP_PUSH_FAILED if stop still unconfirmed
    const alert = await db.alert.findUnique({ where: { id } });
    if (alert?.type === "STOP_PUSH_FAILED") {
      const trade = await db.trade.findFirst({
        where: { ticker: alert.ticker, status: "OPEN", stopPushedAt: null },
      });
      if (trade) {
        return NextResponse.json(
          { error: "Cannot acknowledge — stop is still not pushed to T212. Fix the stop first." },
          { status: 409 },
        );
      }
    }

    await db.alert.update({
      where: { id },
      data: { acknowledged: true },
    });
    return NextResponse.json({ acknowledged: 1 });
  }

  return NextResponse.json({ error: "Provide id or all:true" }, { status: 400 });
}
