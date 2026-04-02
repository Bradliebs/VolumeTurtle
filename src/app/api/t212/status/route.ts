import { NextResponse } from "next/server";
import { loadT212Settings } from "@/lib/t212/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const settings = loadT212Settings();
  return NextResponse.json({ connected: settings != null });
}
