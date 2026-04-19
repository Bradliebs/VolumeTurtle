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
    findFirst: (args: unknown) => Promise<PendingOrderRow | null>;
    update: (args: unknown) => Promise<PendingOrderRow>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
  };
  appSettings: {
    findFirst: (args: { orderBy: { id: "asc" } }) => Promise<{
      autoExecutionEnabled: boolean;
      autoExecutionStartHour: number;
      autoExecutionEndHour: number;
    } | null>;
  };
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};

async function main() {
  console.log(`[executionScheduler] ${new Date().toISOString()} — checking for pending orders…`);

  // Cleanup: delete expired/failed orders older than 24h to keep the table tidy.
  // ExecutionLog rows cascade-delete with their parent PendingOrder.
  const cleanupCutoff = new Date(Date.now() - 24 * 60 * 60_000);
  const cleaned = await db.pendingOrder.deleteMany({
    where: {
      status: { in: ["expired", "failed"] },
      createdAt: { lt: cleanupCutoff },
    },
  });
  if (cleaned.count > 0) {
    console.log(`[executionScheduler] Cleaned up ${cleaned.count} expired/failed order(s) older than 24h`);
  }

  // Check if auto-execution is globally enabled
  const settings = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
  if (!settings?.autoExecutionEnabled) {
    console.log("[executionScheduler] Auto-execution is disabled — exiting");
    return;
  }

  // Check execution hours (UTC)
  const now = new Date();
  const utcHour = now.getUTCHours();
  const startHour = settings.autoExecutionStartHour ?? 14;
  const endHour = settings.autoExecutionEndHour ?? 20;

  if (utcHour < startHour || utcHour >= endHour) {
    console.log(`[executionScheduler] Outside execution hours (${startHour}:00–${endHour}:00 UTC, current: ${utcHour}:00) — exiting`);
    return;
  }

  // Skip weekends
  const day = now.getUTCDay();
  if (day === 0 || day === 6) {
    console.log("[executionScheduler] Weekend — exiting");
    return;
  }

  // Recover stale "processing" orders (stuck from crashed previous run)
  // If an order has been "processing" for >5 minutes without an update, mark it as "failed"
  const staleThreshold = new Date(now.getTime() - 5 * 60_000);
  const staleOrders = await db.pendingOrder.findMany({
    where: {
      status: "processing" as string,
      updatedAt: { lte: staleThreshold },
    },
  });
  for (const stale of staleOrders) {
    console.log(`  [STALE] Recovering stuck order #${stale.id} (${stale.ticker}) — marking as failed`);
    await db.pendingOrder.update({
      where: { id: stale.id },
      data: { status: "failed", failureReason: "Stuck in processing state — scheduler crash suspected" },
    });
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
      // Re-check autoExecutionEnabled before each order — if toggled off mid-batch,
      // stop picking up new orders (already-executing orders complete normally).
      const freshSettings = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
      if (!freshSettings?.autoExecutionEnabled) {
        console.log("[executionScheduler] Auto-execution disabled mid-batch — stopping");
        break;
      }

      // Atomically claim the order inside a transaction: read-check-update.
      // Prevents two scheduler instances from both claiming the same order.
      const claimed = await db.$transaction(async (tx) => {
        const txDb = tx as typeof db;
        const fresh = await txDb.pendingOrder.findFirst({
          where: { id: order.id, status: "pending" },
        } as unknown);
        if (!fresh) return false;
        await txDb.pendingOrder.update({
          where: { id: order.id },
          data: { status: "processing" },
        } as unknown);
        return true;
      });
      if (!claimed) {
        console.log(`  [SKIP] ${order.ticker} (order #${order.id}) — already claimed by another instance`);
        continue;
      }

      console.log(`  [PROCESS] ${order.ticker} (order #${order.id})`);
      await processPendingOrder({ ...order, status: "processing" });

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
