import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { pushStopToT212 } from "@/lib/t212/pushStop";
import { createLogger } from "@/lib/logger";

const log = createLogger("push-stops");

const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<Array<{
      id: string;
      ticker: string;
      shares: number;
      hardStop: number;
      trailingStop: number;
      hardStopPrice: number | null;
      trailingStopPrice: number | null;
      stopPushedAt: Date | null;
      stopPushAttempts: number;
      stopPushError: string | null;
    }>>;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
};

/**
 * GET /api/execution/push-stops — List unprotected positions
 */
export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const unprotected = await db.trade.findMany({
    where: { status: "OPEN", stopPushedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ unprotected, count: unprotected.length });
}

/**
 * POST /api/execution/push-stops — Manual retry for all unprotected positions
 */
export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 3, 60_000);
  if (limited) return limited;

  const unprotected = await db.trade.findMany({
    where: { status: "OPEN", stopPushedAt: null },
  });

  if (unprotected.length === 0) {
    return NextResponse.json({ message: "No unprotected positions", results: [] });
  }

  const results: Array<{ ticker: string; success: boolean; error: string | null }> = [];

  for (const trade of unprotected) {
    const stopPrice = Math.max(
      trade.hardStopPrice ?? trade.hardStop,
      trade.trailingStopPrice ?? trade.trailingStop,
    );

    if (stopPrice <= 0) {
      results.push({ ticker: trade.ticker, success: false, error: "No valid stop price" });
      continue;
    }

    const attempt = trade.stopPushAttempts + 1;
    log.info({ ticker: trade.ticker, stopPrice, attempt }, "Manual stop push retry");

    const result = await pushStopToT212(trade.ticker, trade.shares, stopPrice);

    if (result.success) {
      await db.trade.update({
        where: { id: trade.id },
        data: {
          stopPushedAt: new Date(),
          stopPushAttempts: attempt,
          stopPushError: null,
        },
      });
      results.push({ ticker: trade.ticker, success: true, error: null });
    } else {
      await db.trade.update({
        where: { id: trade.id },
        data: {
          stopPushAttempts: attempt,
          stopPushError: result.error,
        },
      });
      results.push({ ticker: trade.ticker, success: false, error: result.error });
    }
  }

  return NextResponse.json({
    message: `Processed ${results.length} position(s)`,
    results,
    successCount: results.filter((r) => r.success).length,
    failCount: results.filter((r) => !r.success).length,
  });
}
