import { NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { getCruiseControlState } from "@/lib/cruise-control/cruise-control-engine";
import { initCruiseControl } from "@/lib/cruise-control/init";

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  await initCruiseControl();

  const state = await getCruiseControlState();
  return NextResponse.json(state);
}
