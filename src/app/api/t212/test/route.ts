import { NextRequest, NextResponse } from "next/server";
import { testConnection } from "@/lib/t212/client";
import type { T212Settings } from "@/lib/t212/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

export async function POST(request: NextRequest) {
  const limited = rateLimit(getRateLimitKey(request), 5, 60_000);
  if (limited) return limited;

  try {
    const body = await request.json();
    const { apiKey, apiSecret, environment } = body;

    if (!apiKey || !environment) {
      return NextResponse.json({ error: "Missing apiKey or environment" }, { status: 400 });
    }

    const settings: T212Settings = {
      environment,
      apiKey,
      apiSecret: apiSecret ?? "",
      accountType: "isa",
    };

    const result = await testConnection(settings);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Test failed" },
      { status: 500 },
    );
  }
}
