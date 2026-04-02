import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { getRecentAlerts, acknowledgeAlert, acknowledgeAllAlerts, type AlertType } from "@/lib/cruise-control/cruise-control-alerting";

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

export async function PATCH(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  try {
    const body = await req.json();
    const { id, all } = body as { id?: number; all?: boolean };

    if (all) {
      const count = await acknowledgeAllAlerts();
      return NextResponse.json({ acknowledged: count });
    }

    if (id != null) {
      await acknowledgeAlert(id);
      return NextResponse.json({ acknowledged: 1 });
    }

    return NextResponse.json({ error: "Provide id or all:true" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
