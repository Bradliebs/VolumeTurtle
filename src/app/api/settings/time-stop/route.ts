import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/settings/time-stop");

const db = prisma as unknown as {
  appSettings: {
    findFirst: (args: { orderBy: { id: "asc" } }) => Promise<{
      id: number;
      timeStopEnabled?: boolean;
      timeStopDays?: number;
      timeStopMinR?: number;
    } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
  timeStopFlag: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: number;
        tradeId: string;
        ticker: string;
        daysHeld: number;
        rMultiple: number;
        entryPrice: number;
        currentStop: number;
        flaggedAt: Date;
      }>
    >;
    update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<unknown>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const [row, flags] = await Promise.all([
    db.appSettings.findFirst({ orderBy: { id: "asc" } }),
    db.timeStopFlag.findMany({
      where: { dismissed: false },
      orderBy: { flaggedAt: "desc" },
      select: {
        id: true,
        tradeId: true,
        ticker: true,
        daysHeld: true,
        rMultiple: true,
        entryPrice: true,
        currentStop: true,
        flaggedAt: true,
      },
    } as unknown),
  ]);

  return NextResponse.json({
    timeStopEnabled: row?.timeStopEnabled ?? true,
    timeStopDays: row?.timeStopDays ?? 25,
    timeStopMinR: row?.timeStopMinR ?? 0.5,
    activeFlags: flags.map((f) => ({
      ...f,
      flaggedAt: f.flaggedAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  const body = (await req.json()) as {
    timeStopEnabled?: boolean;
    timeStopDays?: number;
    timeStopMinR?: number;
  };

  if (body.timeStopDays != null && (body.timeStopDays < 1 || body.timeStopDays > 365)) {
    return NextResponse.json({ error: "timeStopDays must be 1–365" }, { status: 400 });
  }
  if (body.timeStopMinR != null && (body.timeStopMinR < -5 || body.timeStopMinR > 10)) {
    return NextResponse.json({ error: "timeStopMinR must be between -5 and 10" }, { status: 400 });
  }

  await db.appSettings.upsert({
    where: { id: 1 },
    create: {
      timeStopEnabled: body.timeStopEnabled ?? true,
      timeStopDays: body.timeStopDays ?? 25,
      timeStopMinR: body.timeStopMinR ?? 0.5,
    },
    update: {
      ...(body.timeStopEnabled != null && { timeStopEnabled: body.timeStopEnabled }),
      ...(body.timeStopDays != null && { timeStopDays: body.timeStopDays }),
      ...(body.timeStopMinR != null && { timeStopMinR: body.timeStopMinR }),
    },
  });

  log.info(body, "Time-stop settings updated");
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 10, 60_000);
  if (limited) return limited;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "valid ?id= required" }, { status: 400 });
  }

  await db.timeStopFlag.update({
    where: { id },
    data: { dismissed: true, dismissedAt: new Date() },
  });

  log.info({ id }, "Time-stop flag dismissed");
  return NextResponse.json({ ok: true });
}
