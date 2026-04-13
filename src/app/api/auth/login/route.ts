import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

export async function POST(request: Request) {
  // Rate limit: 5 attempts per minute
  const rlKey = getRateLimitKey(request);
  const rlResponse = rateLimit(rlKey, 5, 60_000);
  if (rlResponse) return rlResponse;

  const token = process.env.DASHBOARD_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const provided = typeof body?.token === "string" ? body.token : "";

  const tokensMatch = provided.length === token.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(token));

  if (!tokensMatch) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("vt-auth", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
