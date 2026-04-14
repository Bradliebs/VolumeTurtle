import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/export/signals");

export async function GET() {
  const limited = rateLimit("export-signals", 10, 60_000);
  if (limited) return limited;

  try {
  const results = await prisma.scanResult.findMany({
    orderBy: { scanDate: "desc" },
  });

  const headers = [
    "scanDate",
    "ticker",
    "signalFired",
    "volumeRatio",
    "rangePosition",
    "atr20",
    "actionTaken",
    "createdAt",
  ];

  const rows = results.map((r) => [
    r.scanDate.toISOString().split("T")[0],
    r.ticker,
    r.signalFired,
    r.volumeRatio ?? "",
    r.rangePosition ?? "",
    r.atr20 ?? "",
    r.actionTaken ?? "",
    r.createdAt.toISOString().split("T")[0],
  ]);

  const csv = [
    headers.join(","),
    ...rows.map((r) => r.map((v) => `"${v}"`).join(",")),
  ].join("\n");

  const today = new Date().toISOString().split("T")[0];

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="volumeturtle_signals_${today}.csv"`,
    },
  });
  } catch (err) {
    log.error({ err }, "Export signals failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 },
    );
  }
}
