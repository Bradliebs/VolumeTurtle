import { NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import {
  startCruiseControl,
  stopCruiseControl,
  getCruiseControlState,
} from "@/lib/cruise-control/cruise-control-engine";

export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  try {
    const currentState = await getCruiseControlState();
    if (currentState.isEnabled) {
      await stopCruiseControl();
    } else {
      await startCruiseControl();
    }

    const state = await getCruiseControlState();
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
