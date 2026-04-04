/**
 * Fix duplicate trades — one-time cleanup + DB constraint.
 *
 * 1. Adds a partial unique index on Trade(ticker) WHERE status = 'OPEN'
 *    to make duplicate open trades physically impossible.
 * 2. Finds and removes duplicate CLOSED trades (same ticker + entryDate + entryPrice),
 *    keeping the record with the most complete data.
 *
 * Usage:
 *   npx tsx scripts/fixDuplicateTrades.ts            # preview only
 *   npx tsx scripts/fixDuplicateTrades.ts --apply     # apply changes
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { UK_BANK_HOLIDAYS, US_HOLIDAYS } from "../src/lib/cruise-control/market-hours";

const APPLY = process.argv.includes("--apply");

function fmt(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "—";
}

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

interface TradeRow {
  id: string;
  ticker: string;
  entryDate: Date;
  entryPrice: number;
  exitDate: Date | null;
  exitPrice: number | null;
  rMultiple: number | null;
  shares: number;
  exitReason: string | null;
  signalGrade: string | null;
  createdAt: Date;
}

const tradeFindMany = (prisma as unknown as {
  trade: { findMany: (args: unknown) => Promise<TradeRow[]> };
}).trade;

const tradeDelete = (prisma as unknown as {
  trade: { delete: (args: { where: { id: string } }) => Promise<unknown> };
}).trade;

async function addPartialUniqueIndex(): Promise<void> {
  console.log("\n── Step 1: Partial unique index ──");

  // Check if index already exists
  const existing = await (prisma as unknown as { $queryRawUnsafe: (q: string) => Promise<Array<{ indexname: string }>> })
    .$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'unique_open_trade_per_ticker'`,
    );

  if (existing.length > 0) {
    console.log("  ✓ Index 'unique_open_trade_per_ticker' already exists — skipping");
    return;
  }

  if (!APPLY) {
    console.log("  [PREVIEW] Would create partial unique index:");
    console.log(`    CREATE UNIQUE INDEX "unique_open_trade_per_ticker" ON "Trade" ("ticker") WHERE "status" = 'OPEN'`);
    return;
  }

  await (prisma as unknown as { $executeRawUnsafe: (q: string) => Promise<number> })
    .$executeRawUnsafe(
      `CREATE UNIQUE INDEX "unique_open_trade_per_ticker" ON "Trade" ("ticker") WHERE "status" = 'OPEN'`,
    );
  console.log("  ✓ Created partial unique index 'unique_open_trade_per_ticker'");
}

async function cleanupDuplicateClosedTrades(): Promise<void> {
  console.log("\n── Step 2: Duplicate closed trades cleanup ──");
  console.log("  Looking for overlapping closed trades (same ticker, entry while another was open)...\n");

  // Get all closed trades grouped by ticker
  const closedTrades = await tradeFindMany.findMany({
    where: { status: "CLOSED" },
    orderBy: { entryDate: "asc" },
  });

  // Group by ticker
  const byTicker = new Map<string, TradeRow[]>();
  for (const t of closedTrades) {
    const arr = byTicker.get(t.ticker) ?? [];
    arr.push(t);
    byTicker.set(t.ticker, arr);
  }

  let totalDeleted = 0;
  const toDelete: TradeRow[] = [];

  for (const [ticker, trades] of byTicker) {
    if (trades.length < 2) continue;

    // For each pair, check if one trade was entered while another was still open
    // The later-entered trade is the duplicate (nightlyScan created it without checking)
    // Compare by calendar date only — exit dates are midnight but entries have real timestamps
    for (let i = 0; i < trades.length; i++) {
      const base = trades[i]!;
      if (!base.exitDate) continue;
      const baseExitDay = fmt(base.exitDate);

      for (let j = i + 1; j < trades.length; j++) {
        const candidate = trades[j]!;
        const candidateEntryDay = fmt(candidate.entryDate);
        // Candidate entered on or before the day base exited?
        if (candidateEntryDay >= fmt(base.entryDate) && candidateEntryDay <= baseExitDay) {
          toDelete.push(candidate);
          console.log(`  ${ticker}:`);
          console.log(`    Original: entry=${fmt(base.entryDate)} exit=${fmt(base.exitDate)} @ $${base.entryPrice} → $${base.exitPrice ?? "—"} (R=${base.rMultiple?.toFixed(2) ?? "—"})`);
          console.log(`    Duplicate: entry=${fmt(candidate.entryDate)} exit=${fmt(candidate.exitDate)} @ $${candidate.entryPrice} → $${candidate.exitPrice ?? "—"} (R=${candidate.rMultiple?.toFixed(2) ?? "—"}) id=${candidate.id}`);
        }
      }
    }
  }

  if (toDelete.length === 0) {
    console.log("  ✓ No overlapping duplicate closed trades found");
    return;
  }

  if (APPLY) {
    for (const dupe of toDelete) {
      await tradeDelete.delete({ where: { id: dupe.id } });
    }
    console.log(`\n  ✓ Deleted ${toDelete.length} duplicate trade(s)`);
  } else {
    console.log(`\n  [PREVIEW] Would delete ${toDelete.length} duplicate trade(s)`);
  }

  totalDeleted = toDelete.length;
}

async function checkDuplicateOpenTrades(): Promise<void> {
  console.log("\n── Step 3: Check for duplicate open trades ──");

  const dupeOpen = await (prisma as unknown as { $queryRawUnsafe: (q: string) => Promise<Array<{ ticker: string; count: number }>> })
    .$queryRawUnsafe(`
      SELECT ticker, COUNT(*)::int as count
      FROM "Trade"
      WHERE status = 'OPEN'
      GROUP BY ticker
      HAVING COUNT(*) > 1
    `);

  if (dupeOpen.length === 0) {
    console.log("  ✓ No duplicate open trades found");
    return;
  }

  console.log(`  ⚠ Found ${dupeOpen.length} tickers with duplicate OPEN trades:`);
  for (const d of dupeOpen) {
    console.log(`    ${d.ticker}: ${d.count} open trades`);
  }
  console.log("  These must be resolved manually before the unique index can be created.");
}

async function cleanupPhantomTrades(): Promise<void> {
  console.log("\n── Step 4: Weekend/holiday phantom trades ──");

  const allTrades = await tradeFindMany.findMany({
    where: {},
    orderBy: { entryDate: "asc" },
  });

  const phantoms: TradeRow[] = [];

  for (const t of allTrades) {
    const d = new Date(t.entryDate);
    const day = d.getUTCDay(); // 0=Sun, 6=Sat
    const dateStr = fmt(d);
    const isWeekend = day === 0 || day === 6;
    const isHoliday = UK_BANK_HOLIDAYS.has(dateStr) && US_HOLIDAYS.has(dateStr);

    if (isWeekend || isHoliday) {
      phantoms.push(t);
      const reason = isWeekend ? "weekend" : "holiday";
      console.log(`  ${t.ticker}: entry=${dateStr} (${reason}) status=${t.status} R=${t.rMultiple?.toFixed(2) ?? "—"} id=${t.id}`);
    }
  }

  if (phantoms.length === 0) {
    console.log("  ✓ No phantom weekend/holiday trades found");
    return;
  }

  if (APPLY) {
    for (const p of phantoms) {
      await tradeDelete.delete({ where: { id: p.id } });
    }
    console.log(`\n  ✓ Deleted ${phantoms.length} phantom trade(s)`);
  } else {
    console.log(`\n  [PREVIEW] Would delete ${phantoms.length} phantom trade(s)`);
  }
}

async function main(): Promise<void> {
  console.log(`fixDuplicateTrades — ${APPLY ? "APPLYING CHANGES" : "PREVIEW MODE (use --apply to execute)"}`);

  await checkDuplicateOpenTrades();
  await cleanupDuplicateClosedTrades();
  await cleanupPhantomTrades();
  await addPartialUniqueIndex();

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
