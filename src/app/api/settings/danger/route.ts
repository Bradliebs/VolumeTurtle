import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { dangerActionSchema, validateBody } from "@/lib/validation";

export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, dangerActionSchema);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action } = parsed.data;

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
