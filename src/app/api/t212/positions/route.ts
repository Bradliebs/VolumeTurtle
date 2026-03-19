import { NextResponse } from "next/server";
import { loadT212Settings, getPositionsWithStopsMapped } from "@/lib/t212/client";
import { rateLimit } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/t212/positions");

export async function GET() {
  // Rate limit: max 5 T212 calls per minute
  const limited = rateLimit("t212-positions", 5, 60_000);
  if (limited) return limited;

  try {
    const settings = loadT212Settings();
    if (!settings) {
      return NextResponse.json({ error: "T212 not configured" }, { status: 400 });
    }

    const positions = await getPositionsWithStopsMapped(settings);
    return NextResponse.json({ positions });
  } catch (err) {
    log.error({ err }, "T212 positions fetch failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch positions" },
      { status: 500 },
    );
  }
}
