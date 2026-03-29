import { NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { ratchetAllStops } from "@/lib/risk/ratchetStops";

export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 3, 60_000);
  if (limited) return limited;

  const result = await ratchetAllStops(true);
  return NextResponse.json(result);
}
