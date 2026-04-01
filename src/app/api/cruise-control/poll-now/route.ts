import { NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { runSinglePoll, getCruiseControlState } from "@/lib/cruise-control/cruise-control-engine";
import { initCruiseControl } from "@/lib/cruise-control/init";

export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 3, 60_000);
  if (limited) return limited;

  await initCruiseControl();

  const state = await getCruiseControlState();
  if (!state.isEnabled) {
    return NextResponse.json(
      { error: "Cruise control is OFF — enable it before polling" },
      { status: 400 },
    );
  }

  try {
    const result = await runSinglePoll();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
