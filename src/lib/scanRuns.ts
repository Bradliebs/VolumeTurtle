import { prisma } from "@/db/client";
import { createLogger } from "@/lib/logger";

const log = createLogger("scanRuns");

const STALE_THRESHOLD_MS = 30 * 60_000; // 30 minutes

const db = prisma as unknown as {
  scanRun: {
    updateMany: (args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
};

/**
 * Mark any ScanRun with status="RUNNING" older than STALE_THRESHOLD_MS as
 * FAILED. Called at the start of every new scan to clean up zombie rows left
 * behind by hard process exits (SIGKILL, OOM, power loss) where the route's
 * try/catch never fired.
 *
 * Best-effort: never throws — a sweep failure must not block the new scan.
 */
export async function reapStaleScanRuns(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
    const result = await db.scanRun.updateMany({
      where: { status: "RUNNING", startedAt: { lt: cutoff } },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        error: `Marked FAILED by reaper — RUNNING for >${STALE_THRESHOLD_MS / 60_000}min, presumed crashed`,
      },
    });
    if (result.count > 0) {
      log.warn({ reaped: result.count }, "Reaped stale RUNNING ScanRun records");
    }
    return result.count;
  } catch (err) {
    log.error({ err }, "reapStaleScanRuns failed");
    return 0;
  }
}
