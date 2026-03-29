import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const db = prisma as unknown as {
  momentumSignal: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  scanRun: {
    findFirst: (args: unknown) => Promise<{
      id: number;
      startedAt: Date;
      marketRegime: string | null;
      regimeScore: number | null;
      regimeAssessment: string | null;
      vixLevel: string | null;
      vixValue: number | null;
      qqqVs200MA: number | null;
    } | null>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status") ?? "active";
  const minGrade = url.searchParams.get("minGrade");
  const sectorsParam = url.searchParams.get("sectors");

  // Only return signals from the latest completed momentum scan
  const latestRun = await db.scanRun.findFirst({
    where: { scanType: "momentum", status: "COMPLETED" },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      startedAt: true,
      marketRegime: true,
      regimeScore: true,
      regimeAssessment: true,
      vixLevel: true,
      vixValue: true,
      qqqVs200MA: true,
    },
  });

  if (!latestRun) {
    return NextResponse.json({ signals: [], nearMisses: [], regime: null });
  }

  const where: Record<string, unknown> = { scanRunId: latestRun.id };

  if (statusFilter !== "all") {
    where.status = statusFilter;
  }

  if (minGrade) {
    const gradeOrder = ["A", "B", "C", "D"];
    const idx = gradeOrder.indexOf(minGrade.toUpperCase());
    if (idx >= 0) {
      where.grade = { in: gradeOrder.slice(0, idx + 1) };
    }
  }

  if (sectorsParam) {
    const sectorList = sectorsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (sectorList.length > 0) {
      where.sector = { in: sectorList };
    }
  }

  const signals = await db.momentumSignal.findMany({
    where,
    orderBy: { compositeScore: "desc" },
    take: 100,
  });

  const nearMisses = await db.momentumSignal.findMany({
    where: { scanRunId: latestRun.id, status: "near-miss" },
    orderBy: { compositeScore: "desc" },
    take: 20,
  });

  return NextResponse.json({
    signals,
    nearMisses,
    regime: latestRun ? {
      marketRegime: latestRun.marketRegime,
      regimeScore: latestRun.regimeScore,
      regimeAssessment: latestRun.regimeAssessment,
      vixLevel: latestRun.vixLevel,
      vixValue: latestRun.vixValue,
      qqqVs200MA: latestRun.qqqVs200MA,
      scanRunAt: latestRun.startedAt.toISOString(),
    } : null,
  });
}
