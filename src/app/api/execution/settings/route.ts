import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const db = prisma as unknown as {
  appSettings: {
    findFirst: (args: { orderBy: { id: "asc" } }) => Promise<{
      id: number;
      autoExecutionEnabled: boolean;
      autoExecutionMinGrade: string;
      autoExecutionWindowMins: number;
      autoExecutionMaxPerDay: number;
      autoExecutionStartHour: number;
      autoExecutionEndHour: number;
    } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
};

/**
 * GET /api/execution/settings
 * Returns current auto-execution settings.
 */
export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const row = await db.appSettings.findFirst({ orderBy: { id: "asc" } });

  return NextResponse.json({
    autoExecutionEnabled: row?.autoExecutionEnabled ?? false,
    autoExecutionMinGrade: row?.autoExecutionMinGrade ?? "B",
    autoExecutionWindowMins: row?.autoExecutionWindowMins ?? 15,
    autoExecutionMaxPerDay: row?.autoExecutionMaxPerDay ?? 2,
    autoExecutionStartHour: row?.autoExecutionStartHour ?? 14,
    autoExecutionEndHour: row?.autoExecutionEndHour ?? 20,
  });
}

/**
 * POST /api/execution/settings
 * Update auto-execution settings.
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  const body = await req.json();
  const {
    autoExecutionEnabled,
    autoExecutionMinGrade,
    autoExecutionWindowMins,
    autoExecutionMaxPerDay,
    autoExecutionStartHour,
    autoExecutionEndHour,
  } = body as {
    autoExecutionEnabled?: boolean;
    autoExecutionMinGrade?: string;
    autoExecutionWindowMins?: number;
    autoExecutionMaxPerDay?: number;
    autoExecutionStartHour?: number;
    autoExecutionEndHour?: number;
  };

  // Validate
  if (autoExecutionMinGrade != null && !["A", "B"].includes(autoExecutionMinGrade)) {
    return NextResponse.json({ error: "minGrade must be 'A' or 'B'" }, { status: 400 });
  }
  if (autoExecutionWindowMins != null && (autoExecutionWindowMins < 5 || autoExecutionWindowMins > 60)) {
    return NextResponse.json({ error: "Window must be 5–60 minutes" }, { status: 400 });
  }
  if (autoExecutionMaxPerDay != null && (autoExecutionMaxPerDay < 1 || autoExecutionMaxPerDay > 10)) {
    return NextResponse.json({ error: "Max per day must be 1–10" }, { status: 400 });
  }
  if (autoExecutionStartHour != null && (autoExecutionStartHour < 0 || autoExecutionStartHour > 23)) {
    return NextResponse.json({ error: "Start hour must be 0–23" }, { status: 400 });
  }
  if (autoExecutionEndHour != null && (autoExecutionEndHour < 0 || autoExecutionEndHour > 23)) {
    return NextResponse.json({ error: "End hour must be 0–23" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (autoExecutionEnabled != null) data.autoExecutionEnabled = autoExecutionEnabled;
  if (autoExecutionMinGrade != null) data.autoExecutionMinGrade = autoExecutionMinGrade;
  if (autoExecutionWindowMins != null) data.autoExecutionWindowMins = autoExecutionWindowMins;
  if (autoExecutionMaxPerDay != null) data.autoExecutionMaxPerDay = autoExecutionMaxPerDay;
  if (autoExecutionStartHour != null) data.autoExecutionStartHour = autoExecutionStartHour;
  if (autoExecutionEndHour != null) data.autoExecutionEndHour = autoExecutionEndHour;

  const existing = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
  await db.appSettings.upsert({
    where: { id: existing?.id ?? 1 },
    create: { ...data },
    update: { ...data },
  });

  return NextResponse.json({ success: true });
}
