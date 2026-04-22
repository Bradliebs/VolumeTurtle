/**
 * Reconcile the FCEL position: T212 holds 11 shares but the DB Trade row
 * only tracks 5.5 (autoExecutor gave up at 5s and never created a Trade;
 * a subsequent T212 import only captured one of two fills).
 *
 * This script:
 *   1) Reads the actual T212 position (truth source).
 *   2) Updates the OPEN Trade row's `shares` to match T212.
 *   3) Re-pushes the existing hardStop to T212 covering the full quantity
 *      (cancels the existing 5.5-share stop order, places a new 11-share one).
 *
 * Safe to re-run. Use --dry to preview.
 */
import "dotenv/config";
import { prisma } from "../src/db/client";
import { loadT212Settings, getOpenPositions } from "../src/lib/t212/client";
import { pushStopToT212 } from "../src/lib/t212/pushStop";

const TICKER_YAHOO = "FCEL";
const DRY = process.argv.includes("--dry");

const db = prisma as unknown as {
  trade: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
  };
};

async function main(): Promise<void> {
  console.log(`[reconcileFcel] Mode: ${DRY ? "DRY RUN" : "LIVE"}`);

  const trade = await db.trade.findFirst({
    where: { ticker: TICKER_YAHOO, status: "OPEN" },
  });
  if (!trade) throw new Error(`No OPEN Trade found for ${TICKER_YAHOO}`);

  const settings = loadT212Settings();
  if (!settings) throw new Error("T212 settings not configured");
  const positions = await getOpenPositions(settings);
  const t212Pos = positions.find((p) => p.ticker.toUpperCase().startsWith("FCEL"));
  if (!t212Pos) throw new Error(`No FCEL position in T212`);

  const dbShares = trade["shares"] as number;
  const t212Shares = t212Pos.quantity;
  const t212AvgPrice = t212Pos.averagePrice;
  const hardStop = trade["hardStop"] as number;

  console.log(`[reconcileFcel] DB: ${dbShares} shares @ $${trade["entryPrice"]}`);
  console.log(`[reconcileFcel] T212: ${t212Shares} shares @ $${t212AvgPrice}`);
  console.log(`[reconcileFcel] Existing hard stop in DB: $${hardStop}`);

  if (Math.abs(dbShares - t212Shares) < 0.01) {
    console.log(`[reconcileFcel] Quantities already match — nothing to reconcile.`);
    process.exit(0);
  }

  if (DRY) {
    console.log(`[reconcileFcel] DRY RUN — would:`);
    console.log(`  - Update Trade.shares: ${dbShares} → ${t212Shares}`);
    console.log(`  - Update Trade.entryPrice: ${trade["entryPrice"]} → ${t212AvgPrice}`);
    console.log(`  - Re-push stop $${hardStop} for ${t212Shares} shares to T212 (cancels existing stop)`);
    process.exit(0);
  }

  // 1) Update the Trade row to match T212 reality
  const updated = await db.trade.update({
    where: { id: trade["id"] as string },
    data: {
      shares: t212Shares,
      entryPrice: t212AvgPrice,
      lastSyncedAt: new Date(),
    },
  });
  console.log(`[reconcileFcel] Trade ${updated["id"]} updated: ${t212Shares} shares @ $${t212AvgPrice}`);

  // 2) Re-push the stop covering ALL 11 shares
  console.log(`[reconcileFcel] Pushing stop $${hardStop} to T212 for ${t212Shares} shares...`);
  const stopResult = await pushStopToT212(TICKER_YAHOO, t212Shares, hardStop, settings);
  if (stopResult.success) {
    console.log(`[reconcileFcel] Stop pushed successfully. Order: ${JSON.stringify(stopResult.placedOrder)}`);
  } else {
    console.error(`[reconcileFcel] Stop push FAILED: ${stopResult.error}.`);
    console.error(`  Set stop manually in T212 at $${hardStop} for all ${t212Shares} shares.`);
    process.exit(1);
  }

  console.log(`[reconcileFcel] DONE. ${TICKER_YAHOO} now tracked correctly. Cruise control will manage the full position.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
