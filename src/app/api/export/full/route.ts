import { NextResponse } from "next/server";
import { prisma } from "@/db/client";

export async function GET() {
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
}
