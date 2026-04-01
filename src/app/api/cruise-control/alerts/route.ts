import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { getRecentAlerts, type AlertType } from "@/lib/cruise-control/cruise-control-alerting";

export async function GET(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  try {
    const typeParam = req.nextUrl.searchParams.get("type") as AlertType | null;
    const hoursParam = req.nextUrl.searchParams.get("hours");
    const hours = hoursParam ? parseInt(hoursParam, 10) : 24;

    const alerts = await getRecentAlerts(hours, typeParam ?? undefined);
    return NextResponse.json(alerts);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
