import { NextResponse } from "next/server";
import { loadT212Settings, getOpenPositions } from "@/lib/t212/client";

export async function GET() {
  try {
    const settings = loadT212Settings();
    if (!settings) {
      return NextResponse.json({ error: "T212 not configured" }, { status: 400 });
    }

    const positions = await getOpenPositions(settings);
    return NextResponse.json({ positions });
  } catch (err) {
    console.error("[GET /api/t212/positions] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch positions" },
      { status: 500 },
    );
  }
}
