import { NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { runSinglePoll } from "@/lib/cruise-control/cruise-control-engine";
import { initCruiseControl } from "@/lib/cruise-control/init";

export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 3, 60_000);
  if (limited) return limited;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const dryRun = body["dryRun"] === true;

    if (dryRun) {
      // runSinglePoll doesn't support dryRun natively — return current state only
      return NextResponse.json({
        ok: true,
        dryRun: true,
        message: "Dry run — no ratchets pushed. Use dryRun=false to execute.",
      });
    }

    await initCruiseControl();
    const result = await runSinglePoll();
    return NextResponse.json({ ok: true, dryRun: false, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
