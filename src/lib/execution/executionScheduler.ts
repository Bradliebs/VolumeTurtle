/**
 * Execution scheduler — polls for pending orders whose cancellation
 * window has elapsed and processes them through pre-flight + execution.
 *
 * Runs every 60 seconds during market hours via Task Scheduler.
 */

import { prisma } from "@/db/client";
import { createLogger } from "@/lib/logger";
import { processPendingOrder, type PendingOrderRow } from "@/lib/execution/autoExecutor";

const log = createLogger("executionScheduler");

const db = prisma as unknown as {
  pendingOrder: {
    findMany: (args: unknown) => Promise<PendingOrderRow[]>;
    update: (args: unknown) => Promise<PendingOrderRow>;
  };
  appSettings: {
    findFirst: (args: { orderBy: { id: "asc" } }) => Promise<{
      autoExecutionEnabled: boolean;
      autoExecutionStartHour: number;
      autoExecutionEndHour: number;
    } | null>;
  };
};

/**
 * Process all pending orders whose cancellation window has passed.
 */
export async function processPendingOrders(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  // Check if auto-execution is globally enabled
  const settings = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
  if (!settings?.autoExecutionEnabled) {
    log.info("Auto-execution is disabled — skipping");
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // Check execution hours (UTC)
  const now = new Date();
  const utcHour = now.getUTCHours();
  const startHour = settings.autoExecutionStartHour ?? 14;
  const endHour = settings.autoExecutionEndHour ?? 20;

  if (utcHour < startHour || utcHour >= endHour) {
    log.info({ utcHour, startHour, endHour }, "Outside execution hours — skipping");
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // Skip weekends
  const day = now.getUTCDay();
  if (day === 0 || day === 6) {
    log.info("Weekend — skipping");
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  // Load pending orders whose deadline has passed
  const pendingOrders = await db.pendingOrder.findMany({
    where: {
      status: "pending",
      cancelDeadline: { lte: now },
    },
    orderBy: { createdAt: "asc" },
  });

  if (pendingOrders.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  log.info({ count: pendingOrders.length }, "Found pending orders ready for execution");

  let succeeded = 0;
  let failed = 0;

  for (const order of pendingOrders) {
    try {
      await processPendingOrder(order);
      // Re-read to check status after processing
      const updated = await db.pendingOrder.findMany({
        where: { id: order.id },
      });
      const latestStatus = updated[0]?.status;
      if (latestStatus === "executed") succeeded++;
      else failed++;
    } catch (err) {
      failed++;
      log.error(
        { orderId: order.id, ticker: order.ticker, error: err instanceof Error ? err.message : String(err) },
        "Failed to process pending order",
      );
      // Mark as failed so we don't retry forever
      try {
        await db.pendingOrder.update({
          where: { id: order.id },
          data: {
            status: "failed",
            failureReason: `Scheduler error: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
      } catch { /* best effort */ }
    }
  }

  log.info({ processed: pendingOrders.length, succeeded, failed }, "Execution cycle complete");

  return { processed: pendingOrders.length, succeeded, failed };
}
