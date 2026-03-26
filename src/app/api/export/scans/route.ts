import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/export/scans");

export async function GET() {
  try {
    const results = await prisma.scanResult.findMany({
      orderBy: [{ scanDate: "desc" }, { ticker: "asc" }],
    });

    const headers = [
      "scanDate",
      "ticker",
      "signalFired",
      "compositeGrade",
      "compositeScore",
      "suggestedEntry",
      "hardStop",
      "riskPerShare",
      "shares",
      "totalExposure",
      "dollarRisk",
      "volumeRatio",
      "rangePosition",
      "atr20",
      "regimeScore",
      "trendScore",
      "volumeCompScore",
      "liquidityScore",
      "actionTaken",
    ];

    const rows = results.map((r) => [
      r.scanDate.toISOString().split("T")[0],
      r.ticker,
      r.signalFired,
      r.compositeGrade ?? "",
      r.compositeScore != null ? r.compositeScore.toFixed(4) : "",
      r.suggestedEntry != null ? r.suggestedEntry.toFixed(2) : "",
      r.hardStop != null ? r.hardStop.toFixed(2) : "",
      r.riskPerShare != null ? r.riskPerShare.toFixed(2) : "",
      r.shares != null ? (r.shares >= 1 ? r.shares.toFixed(0) : r.shares.toFixed(4)) : "",
      r.totalExposure != null ? r.totalExposure.toFixed(2) : "",
      r.dollarRisk != null ? r.dollarRisk.toFixed(2) : "",
      r.volumeRatio != null ? r.volumeRatio.toFixed(2) : "",
      r.rangePosition != null ? (r.rangePosition * 100).toFixed(0) + "%" : "",
      r.atr20 != null ? r.atr20.toFixed(4) : "",
      r.regimeScore != null ? r.regimeScore.toFixed(2) : "",
      r.trendScore != null ? r.trendScore.toFixed(2) : "",
      r.volumeCompScore != null ? r.volumeCompScore.toFixed(2) : "",
      r.liquidityScore != null ? r.liquidityScore.toFixed(2) : "",
      r.actionTaken ?? "",
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((r) => r.map((v) => `"${v}"`).join(",")),
    ].join("\n");

    const today = new Date().toISOString().split("T")[0];

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="volumeturtle_scans_${today}.csv"`,
      },
    });
  } catch (err) {
    log.error({ err }, "Export scans failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 },
    );
  }
}
