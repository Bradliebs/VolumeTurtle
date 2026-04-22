/**
 * One-shot recovery for the FCEL orphan from PendingOrder #74.
 *
 * The autoExecutor gave up at 5s waiting for fill confirmation, so no Trade
 * row was created — but T212 then filled the order and we're holding shares
 * with no DB tracking. This script:
 *   1) Reads the actual FCEL position from T212 (truth source).
 *   2) Creates a Trade row using the original signal's hardStop/grade/risk
 *      from PendingOrder #74.
 *   3) Pushes the hard stop to T212 so cruise control can ratchet it.
 *   4) Marks PendingOrder #74 as "executed" so it stops being seen as failed.
 *
 * Usage: npx tsx scripts/adoptFcel.ts [--dry]
 */
import "dotenv/config";
import { prisma } from "../src/db/client";
import { loadT212Settings, getOpenPositions } from "../src/lib/t212/client";
import { pushStopToT212 } from "../src/lib/t212/pushStop";

const TICKER_YAHOO = "FCEL";
const PENDING_ORDER_ID = 74;
const DRY = process.argv.includes("--dry");

const db = prisma as unknown as {
  pendingOrder: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  trade: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
    create: (args: unknown) => Promise<Record<string, unknown>>;
  };
};

async function main(): Promise<void> {
  console.log(`[adoptFcel] Mode: ${DRY ? "DRY RUN" : "LIVE"}`);

  // 1) Verify no Trade row already exists
  const existing = await db.trade.findFirst({
    where: { ticker: TICKER_YAHOO, status: "OPEN" },
  });
  if (existing) {
    console.log(`[adoptFcel] OPEN Trade already exists for ${TICKER_YAHOO} (id=${existing["id"]}). Nothing to do.`);
    process.exit(0);
  }

  // 2) Load PendingOrder #74 for the signal context
  const order = await db.pendingOrder.findUnique({ where: { id: PENDING_ORDER_ID } });
  if (!order || order["ticker"] !== TICKER_YAHOO) {
    throw new Error(`PendingOrder ${PENDING_ORDER_ID} not found or not for ${TICKER_YAHOO}`);
  }
  console.log(`[adoptFcel] PendingOrder #${PENDING_ORDER_ID}: grade=${order["signalGrade"]}, suggestedStop=$${order["suggestedStop"]}, suggestedShares=${order["suggestedShares"]}`);

  // 3) Pull the actual T212 position (truth source)
  const settings = loadT212Settings();
  if (!settings) throw new Error("T212 settings not configured");
  const positions = await getOpenPositions(settings);
  const t212Pos = positions.find((p) => p.ticker.toUpperCase().startsWith("FCEL"));
  if (!t212Pos) {
    throw new Error(`No FCEL position found in T212. T212 may not have filled the order — verify in app.`);
  }
  console.log(`[adoptFcel] T212 position: ticker=${t212Pos.ticker}, qty=${t212Pos.quantity}, avgPrice=${t212Pos.averagePrice}, currentPrice=${t212Pos.currentPrice}`);

  const shares = t212Pos.quantity;
  const entryPrice = t212Pos.averagePrice;
  const hardStop = order["suggestedStop"] as number;
  const atr20 = ((order["suggestedEntry"] as number) - hardStop) / 2; // reverse from riskPerShare = 2*ATR

  // Use volume signal data we know was an A grade
  const volumeRatio = 4.68;
  const rangePosition = 0.76;

  if (DRY) {
    console.log(`[adoptFcel] DRY RUN — would create Trade with:`);
    console.log({
      ticker: TICKER_YAHOO,
      shares,
      entryPrice,
      hardStop,
      trailingStop: hardStop,
      atr20,
      signalGrade: order["signalGrade"],
      signalScore: order["compositeScore"],
      sector: order["sector"],
    });
    console.log(`[adoptFcel] DRY RUN — would push stop $${hardStop} to T212 for ${shares} shares`);
    process.exit(0);
  }

  // 4) Create Trade row
  const trade = await db.trade.create({
    data: {
      ticker: TICKER_YAHOO,
      entryDate: new Date(),
      entryPrice,
      shares,
      hardStop,
      trailingStop: hardStop,
      hardStopPrice: hardStop,
      trailingStopPrice: hardStop,
      stopSource: "ADOPTED",
      status: "OPEN",
      volumeRatio,
      rangePosition,
      atr20,
      signalSource: "volume",
      signalScore: order["compositeScore"] as number,
      signalGrade: order["signalGrade"] as string,
      sector: (order["sector"] as string) ?? "Unknown",
      manualEntry: true,
      importedFromT212: true,
      importedAt: new Date(),
      lastSyncedAt: new Date(),
    },
  });
  console.log(`[adoptFcel] Trade row created: id=${trade["id"]}`);

  // 5) Push stop to T212
  console.log(`[adoptFcel] Pushing stop $${hardStop} to T212 for ${shares} shares...`);
  const stopResult = await pushStopToT212(TICKER_YAHOO, shares, hardStop, settings);
  if (stopResult.success) {
    console.log(`[adoptFcel] Stop pushed successfully. Order: ${JSON.stringify(stopResult.placedOrder)}`);
  } else {
    console.error(`[adoptFcel] Stop push FAILED: ${stopResult.error}. Set stop manually in T212 at $${hardStop}.`);
  }

  // 6) Mark PendingOrder as executed so it stops appearing as failed
  await db.pendingOrder.update({
    where: { id: PENDING_ORDER_ID },
    data: {
      status: "executed",
      executedAt: new Date(),
      actualShares: shares,
      actualPrice: entryPrice,
      failureReason: null,
    },
  });
  console.log(`[adoptFcel] PendingOrder #${PENDING_ORDER_ID} marked as executed.`);

  console.log(`[adoptFcel] DONE. ${TICKER_YAHOO} is now tracked. Cruise control will manage the stop on the next ratchet cycle.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
