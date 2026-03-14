import { NextResponse } from "next/server";
import { prisma } from "@/db/client";

export async function GET() {
  const trades = await prisma.trade.findMany({
    orderBy: { entryDate: "desc" },
    include: { stopHistory: { orderBy: { date: "asc" } } },
  });

  const headers = [
    "id",
    "ticker",
    "entryDate",
    "entryPrice",
    "shares",
    "hardStop",
    "trailingStop",
    "exitDate",
    "exitPrice",
    "exitReason",
    "rMultiple",
    "status",
    "volumeRatio",
    "rangePosition",
    "atr20",
    "stopUpdateCount",
    "createdAt",
  ];

  const rows = trades.map((t) => [
    t.id,
    t.ticker,
    t.entryDate.toISOString().split("T")[0],
    t.entryPrice,
    t.shares,
    t.hardStop,
    t.trailingStop,
    t.exitDate ? t.exitDate.toISOString().split("T")[0] : "",
    t.exitPrice ?? "",
    t.exitReason ?? "",
    t.rMultiple ?? "",
    t.status,
    t.volumeRatio,
    t.rangePosition,
    t.atr20,
    t.stopHistory.length,
    t.createdAt.toISOString().split("T")[0],
  ]);

  const csv = [
    headers.join(","),
    ...rows.map((r) => r.map((v) => `"${v}"`).join(",")),
  ].join("\n");

  const today = new Date().toISOString().split("T")[0];

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="volumeturtle_trades_${today}.csv"`,
    },
  });
}
