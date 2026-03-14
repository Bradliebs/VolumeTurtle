import { NextResponse } from "next/server";
import { prisma } from "@/db/client";

export async function GET() {
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
}
