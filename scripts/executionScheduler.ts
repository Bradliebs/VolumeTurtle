/**
 * Execution scheduler — standalone script for Windows Task Scheduler.
 * Checks for pending orders every run and processes those past their deadline.
 *
 * Usage:
 *   npx tsx scripts/executionScheduler.ts
 *
 * Schedule: every 1 minute during market hours (08:00–21:00 UK time, weekdays)
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { processPendingOrder, logExecution, type PendingOrderRow } from "../src/lib/execution/autoExecutor";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

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

async function main() {
  console.log(`[executionScheduler] ${new Date().toISOString()} — checking for pending orders…`);

  // Check if auto-execution is globally enabled
  const settings = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
  if (!settings?.autoExecutionEnabled) {
    console.log("[executionScheduler] Auto-execution is disabled — exiting");
    return;
  }

  // Check execution hours (Europe/London — handles BST automatically)
  const now = new Date();
  const londonHour = parseInt(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" }).format(now),
    10,
  );
  const startHour = settings.autoExecutionStartHour ?? 14;
  const endHour = settings.autoExecutionEndHour ?? 20;

  if (londonHour < startHour || londonHour >= endHour) {
    console.log(`[executionScheduler] Outside execution hours (${startHour}:00\u2013${endHour}:00 London, current: ${londonHour}:00) \u2014 exiting`);
    return;
  }

  // Skip weekends (London time)
  const londonDay = parseInt(
    new Intl.DateTimeFormat("en-GB", { weekday: "narrow", timeZone: "Europe/London" }).format(now),
    10,
  );
  const day = new Date(now.toLocaleString("en-GB", { timeZone: "Europe/London" })).getDay();
  if (day === 0 || day === 6) {
    console.log("[executionScheduler] Weekend — exiting");
    return;
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
    console.log("[executionScheduler] No pending orders ready for execution");
    return;
  }

  console.log(`[executionScheduler] Processing ${pendingOrders.length} pending order(s)…`);

  let succeeded = 0;
  let failed = 0;

  for (const order of pendingOrders) {
    try {
      console.log(`  [PROCESS] ${order.ticker} (order #${order.id})`);
      await processPendingOrder(order);

      // Re-check status
      const updated = await db.pendingOrder.findMany({
        where: { id: order.id },
      });
      const latestStatus = updated[0]?.status;
      if (latestStatus === "executed") {
        succeeded++;
        console.log(`  [SUCCESS] ${order.ticker} — executed`);
      } else {
        failed++;
        console.log(`  [FAILED] ${order.ticker} — ${latestStatus}: ${updated[0]?.failureReason ?? "unknown"}`);
      }
    } catch (err) {
      failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`  [ERROR] ${order.ticker} — ${errMsg}`);
      try {
        await db.pendingOrder.update({
          where: { id: order.id },
          data: {
            status: "failed",
            failureReason: `Scheduler error: ${errMsg}`,
          },
        });
      } catch { /* best effort */ }
    }
  }

  console.log(`[executionScheduler] Done — ${succeeded} succeeded, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error("[executionScheduler] Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
