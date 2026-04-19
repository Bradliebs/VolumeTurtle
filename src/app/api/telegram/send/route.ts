import { NextRequest, NextResponse } from "next/server";
import { sendTelegram } from "@/lib/telegram";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const message = body["message"];

    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    await sendTelegram({ text: message });
    return NextResponse.json({ sent: true });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error }, { status: 500 });
  }
}
