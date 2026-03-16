import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const token = process.env.DASHBOARD_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  const provided = typeof body?.token === "string" ? body.token : "";

  if (provided !== token) {
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
