import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/internal/cleanup");

const db = prisma as unknown as {
  retryQueue: {
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
  pendingOrder: {
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
};

/**
 * POST /api/internal/cleanup
 * Deletes stale rows to prevent unbounded table growth:
 *   - RetryQueue rows older than 7 days
 *   - PendingOrder rows past their cancelDeadline
 * Designed to be called daily at 06:00 via Task Scheduler.
 */
export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);

  try {
    const retryResult = await db.retryQueue.deleteMany({
      where: { createdAt: { lt: sevenDaysAgo } },
    });

    const pendingResult = await db.pendingOrder.deleteMany({
      where: {
        cancelDeadline: { lt: now },
        status: { in: ["pending", "expired", "failed"] },
      },
    });

    log.info(
      { retryQueueCleaned: retryResult.count, pendingOrdersCleaned: pendingResult.count },
      "Cleanup complete",
    );

    return NextResponse.json({
      cleaned: {
        retryQueue: retryResult.count,
        pendingOrders: pendingResult.count,
      },
      timestamp: now.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, "Cleanup failed");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
