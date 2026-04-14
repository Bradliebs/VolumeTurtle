import { NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { timingSafeEqual } from "crypto";

export async function POST(request: Request) {
  // Rate limit: 10 attempts per minute
  const limited = rateLimit(getRateLimitKey(request), 10, 60_000);
  if (limited) return limited;

  const token = process.env.DASHBOARD_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const provided = typeof body?.token === "string" ? body.token : "";

  // Timing-safe token comparison
  let tokenMatch = false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(token);
    tokenMatch = a.length === b.length && timingSafeEqual(a, b);
  } catch {
    tokenMatch = false;
  }

  if (!tokenMatch) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("vt-auth", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
