import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { dangerActionSchema, validateBody } from "@/lib/validation";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/settings/danger");

export async function POST(request: NextRequest) {
  // Rate limit: max 3 danger actions per minute
  const limited = rateLimit(getRateLimitKey(request), 3, 60_000);
  if (limited) return limited;

  try {
    const parsed = await validateBody(request, dangerActionSchema);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { action } = parsed.data!;

    if (action === "clear-scans") {
      const result = await prisma.scanResult.deleteMany();
      return NextResponse.json({ cleared: result.count, type: "scan_results" });
    }

    if (action === "reset-positions") {
      await prisma.stopHistory.deleteMany();
      const result = await prisma.trade.deleteMany();
      return NextResponse.json({ cleared: result.count, type: "trades" });
    }

    if (action === "reset-balance-history") {
      const result = await prisma.accountSnapshot.deleteMany();

      // Seed a new snapshot from the manual balance setting
      const setting = await prisma.settings.findUnique({ where: { key: "manualBalance" } });
      const balance = setting ? parseFloat(setting.value) : 0;
      if (balance > 0) {
        await prisma.accountSnapshot.create({
          data: { date: new Date(), balance, openTrades: 0 },
        });
      }

      return NextResponse.json({ cleared: result.count, type: "account_snapshots" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    log.error({ err }, "Danger action failed");
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
