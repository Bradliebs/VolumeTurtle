import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const db = prisma as unknown as {
  sectorScanResult: {
    findMany: (args: unknown) => Promise<unknown[]>;
    findFirst: (args: unknown) => Promise<{ runAt: Date; scanRunId: number | null } | null>;
  };
  scanRun: {
    findFirst: (args: unknown) => Promise<{ marketRegime: string | null; regimeScore: number | null; regimeAssessment: string | null } | null>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const latest = await db.sectorScanResult.findFirst({
    orderBy: { runAt: "desc" },
    select: { runAt: true, scanRunId: true },
  });

  if (!latest) {
    return NextResponse.json({ sectors: [], regime: null, runAt: null });
  }

  const sectors = await db.sectorScanResult.findMany({
    where: { runAt: latest.runAt },
    orderBy: { score: "desc" },
  });

  let regime = null;
  if (latest.scanRunId != null) {
    regime = await db.scanRun.findFirst({
      where: { id: latest.scanRunId },
      select: { marketRegime: true, regimeScore: true, regimeAssessment: true },
    });
  }

  return NextResponse.json({
    sectors,
    regime,
    runAt: latest.runAt.toISOString(),
  });
}
