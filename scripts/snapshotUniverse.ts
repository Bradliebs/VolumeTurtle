// CLI: Snapshot the current trading universe to UniverseSnapshot.
//
// Run this weekly (or after every universe change) to build up a point-in-time
// history. Backtests can then be replayed against the universe as it actually
// existed at each historical date — eliminating survivorship bias.
//
// Usage:
//   npx tsx scripts/snapshotUniverse.ts                 # snapshot today
//   npx tsx scripts/snapshotUniverse.ts --date 2026-01-01

import "dotenv/config";
import { prisma } from "../src/db/client";

interface Args {
  date: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let date = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--date" && argv[i + 1]) { date = argv[i + 1]!; i++; }
  }
  return { date };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const snapshotDate = new Date(args.date);

  const db = prisma as unknown as {
    ticker: {
      findMany: (args: unknown) => Promise<Array<{
        symbol: string; sector: string | null; active: boolean;
      }>>;
    };
    universeSnapshot: {
      deleteMany: (args: unknown) => Promise<{ count: number }>;
      createMany: (args: unknown) => Promise<{ count: number }>;
    };
  };

  const tickers = await db.ticker.findMany({ where: { active: true } });
  if (tickers.length === 0) {
    console.error("[snapshot] No active tickers found.");
    process.exit(1);
  }

  // Idempotent: replace any existing snapshot for this date.
  const removed = await db.universeSnapshot.deleteMany({
    where: { snapshotDate },
  });
  if (removed.count > 0) {
    console.log(`[snapshot] Cleared ${removed.count} existing rows for ${args.date}`);
  }

  await db.universeSnapshot.createMany({
    data: tickers.map((t) => ({
      snapshotDate,
      ticker: t.symbol,
      sector: t.sector,
      source: "auto",
    })),
  });

  console.log(`[snapshot] Captured ${tickers.length} tickers for ${args.date}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
