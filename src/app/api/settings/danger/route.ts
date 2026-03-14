import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, confirm } = body;

    if (confirm !== "CONFIRM") {
      return NextResponse.json({ error: "Type CONFIRM to proceed" }, { status: 400 });
    }

    if (action === "clear-scans") {
      const result = await prisma.scanResult.deleteMany();
      return NextResponse.json({ cleared: result.count, type: "scan_results" });
    }

    if (action === "reset-positions") {
      await prisma.stopHistory.deleteMany();
      const result = await prisma.trade.deleteMany();
      return NextResponse.json({ cleared: result.count, type: "trades" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[POST /api/settings/danger] Error:", err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
