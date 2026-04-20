import { NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

/**
 * Lightweight liveness probe.
 *
 * No DB, no external API calls — answers "is the Next.js server reachable
 * and responding?" only. Used by the Task Scheduler watchdog (scripts/watchdog.bat).
 *
 * Auth: requires Bearer DASHBOARD_TOKEN to prevent anonymous probes from
 * being used to confirm the server is reachable. Watchdog calls it with the
 * token loaded from .env.
 */
export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 60, 60_000);
  if (limited) return limited;

  const token = process.env["DASHBOARD_TOKEN"];
  if (token) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${token}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
