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
      maxPositionsPerSector: number;
      gapDownThreshold: number;
      gapUpResizeThreshold: number;
      vixNormalSizeMult: number;
      vixElevatedSizeMult: number;
      earlyPauseToCautionPct: number;
      earlyCautionToNormalPct: number;
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
    autoExecutionWindowMins: row?.autoExecutionWindowMins ?? 240,
    autoExecutionMaxPerDay: row?.autoExecutionMaxPerDay ?? 2,
    autoExecutionStartHour: row?.autoExecutionStartHour ?? 14,
    autoExecutionEndHour: row?.autoExecutionEndHour ?? 20,
    maxPositionsPerSector: row?.maxPositionsPerSector ?? 2,
    gapDownThreshold: row?.gapDownThreshold ?? 0.03,
    gapUpResizeThreshold: row?.gapUpResizeThreshold ?? 0.05,
    vixNormalSizeMult: row?.vixNormalSizeMult ?? 1.0,
    vixElevatedSizeMult: row?.vixElevatedSizeMult ?? 0.75,
    earlyPauseToCautionPct: row?.earlyPauseToCautionPct ?? 22.0,
    earlyCautionToNormalPct: row?.earlyCautionToNormalPct ?? 12.0,
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
    maxPositionsPerSector,
    gapDownThreshold,
    gapUpResizeThreshold,
    vixNormalSizeMult,
    vixElevatedSizeMult,
    earlyPauseToCautionPct,
    earlyCautionToNormalPct,
  } = body as {
    autoExecutionEnabled?: boolean;
    autoExecutionMinGrade?: string;
    autoExecutionWindowMins?: number;
    autoExecutionMaxPerDay?: number;
    autoExecutionStartHour?: number;
    autoExecutionEndHour?: number;
    maxPositionsPerSector?: number;
    gapDownThreshold?: number;
    gapUpResizeThreshold?: number;
    vixNormalSizeMult?: number;
    vixElevatedSizeMult?: number;
    earlyPauseToCautionPct?: number;
    earlyCautionToNormalPct?: number;
  };

  // Validate
  if (autoExecutionMinGrade != null && !["A", "B"].includes(autoExecutionMinGrade)) {
    return NextResponse.json({ error: "minGrade must be 'A' or 'B'" }, { status: 400 });
  }
  if (autoExecutionWindowMins != null && (autoExecutionWindowMins < 5 || autoExecutionWindowMins > 480)) {
    return NextResponse.json({ error: "Window must be 5–480 minutes" }, { status: 400 });
  }
  if (autoExecutionMaxPerDay != null && (autoExecutionMaxPerDay < 1 || autoExecutionMaxPerDay > 10)) {
    return NextResponse.json({ error: "Max per day must be 1–10" }, { status: 400 });
  }
  if (autoExecutionStartHour != null && (autoExecutionStartHour < 0 || autoExecutionStartHour > 23)) {
    return NextResponse.json({ error: "Start hour must be 0–23" }, { status: 400 });
  }
  if (autoExecutionEndHour != null && (autoExecutionEndHour < 0 || autoExecutionEndHour > 23)) {
    return NextResponse.json({ error: "End hour must be 0–23" }, { status: 400 });
  }  if (maxPositionsPerSector != null && (maxPositionsPerSector < 1 || maxPositionsPerSector > 5)) {
    return NextResponse.json({ error: "Max per sector must be 1\u20135" }, { status: 400 });
  }
  if (gapDownThreshold != null && (gapDownThreshold < 0.01 || gapDownThreshold > 0.20)) {
    return NextResponse.json({ error: "Gap-down threshold must be 1\u201320%" }, { status: 400 });
  }
  if (gapUpResizeThreshold != null && (gapUpResizeThreshold < 0.01 || gapUpResizeThreshold > 0.20)) {
    return NextResponse.json({ error: "Gap-up threshold must be 1\u201320%" }, { status: 400 });
  }
  const data: Record<string, unknown> = {};
  if (autoExecutionEnabled != null) data.autoExecutionEnabled = autoExecutionEnabled;
  if (autoExecutionMinGrade != null) data.autoExecutionMinGrade = autoExecutionMinGrade;
  if (autoExecutionWindowMins != null) data.autoExecutionWindowMins = autoExecutionWindowMins;
  if (autoExecutionMaxPerDay != null) data.autoExecutionMaxPerDay = autoExecutionMaxPerDay;
  if (autoExecutionStartHour != null) data.autoExecutionStartHour = autoExecutionStartHour;
  if (autoExecutionEndHour != null) data.autoExecutionEndHour = autoExecutionEndHour;
  if (maxPositionsPerSector != null) data.maxPositionsPerSector = maxPositionsPerSector;
  if (gapDownThreshold != null) data.gapDownThreshold = gapDownThreshold;
  if (gapUpResizeThreshold != null) data.gapUpResizeThreshold = gapUpResizeThreshold;
  if (vixNormalSizeMult != null) data.vixNormalSizeMult = vixNormalSizeMult;
  if (vixElevatedSizeMult != null) data.vixElevatedSizeMult = vixElevatedSizeMult;
  if (earlyPauseToCautionPct != null) data.earlyPauseToCautionPct = earlyPauseToCautionPct;
  if (earlyCautionToNormalPct != null) data.earlyCautionToNormalPct = earlyCautionToNormalPct;

  const existing = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
  await db.appSettings.upsert({
    where: { id: existing?.id ?? 1 },
    create: { ...data },
    update: { ...data },
  });

  return NextResponse.json({ success: true });
}
