import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/export/full");

export async function GET() {
  // Rate limit: max 10 exports per minute
  const limited = rateLimit("export-full", 10, 60_000);
  if (limited) return limited;

  try {
  const [trades, scanResults, scanRuns, accountSnapshots, settings] =
    await Promise.all([
      prisma.trade.findMany({ include: { stopHistory: true } }),
      prisma.scanResult.findMany(),
      prisma.scanRun.findMany(),
      prisma.accountSnapshot.findMany(),
      prisma.settings.findMany(),
    ]);

  const backup = {
    exportedAt: new Date().toISOString(),
    version: "1.0",
    tables: {
      trades,
      scanResults,
      scanRuns,
      accountSnapshots,
      settings,
    },
  };

  const today = new Date().toISOString().split("T")[0];

  return new NextResponse(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="volumeturtle_backup_${today}.json"`,
    },
  });
  } catch (err) {
    log.error({ err }, "Export full failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 },
    );
  }
}
