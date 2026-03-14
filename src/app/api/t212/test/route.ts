import { NextRequest, NextResponse } from "next/server";
import { testConnection } from "@/lib/t212/client";
import type { T212Settings } from "@/lib/t212/client";

export async function POST(request: NextRequest) {
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
