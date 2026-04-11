/**
 * One-time bulk cache seeding script.
 * Fetches 60 days of OHLCV history for all tickers in the universe,
 * making the breadth indicator active immediately.
 *
 * Usage:  npx tsx scripts/seedCache.ts
 *
 * Safe to interrupt and re-run — skips tickers already cached (50+ rows).
 * After this, the nightly scan maintains the cache automatically.
 */
import "dotenv/config";
import { loadUniverse } from "../src/lib/hbme/loadUniverse";
import { fetchEODQuotes } from "../src/lib/data/fetchQuotes";
import { prisma } from "../src/db/client";

const db = prisma as unknown as {
  dailyQuote: {
    groupBy: (args: unknown) => Promise<Array<{ ticker: string; _count: { ticker: number } }>>;
  };
};

async function main() {
  const universe = await loadUniverse();
  const tickers = [...new Set(universe.map((r) => r.ticker))];

  console.log(`Seeding cache for ${tickers.length} tickers...`);

  // Phase 1: find which tickers already have sufficient cache
  const cached = await db.dailyQuote.groupBy({
    by: ["ticker"],
    where: { ticker: { in: tickers } },
    _count: { ticker: true },
  });
  const cachedCounts = new Map(cached.map((r) => [r.ticker, r._count.ticker]));

  const toFetch = tickers.filter((t) => (cachedCounts.get(t) ?? 0) < 50);
  const skipped = tickers.length - toFetch.length;

  console.log(`  ${skipped} already cached (50+ rows)`);
  console.log(`  ${toFetch.length} to fetch`);
  console.log(`  Estimated time: ~${Math.ceil(toFetch.length / 10 * 0.6)} minutes\n`);

  if (toFetch.length === 0) {
    console.log("Nothing to do — cache is already seeded.");
    return;
  }

  // Phase 2: fetch in batches using the existing fetchEODQuotes
  // (it handles batching, caching to DB, and rate limiting internally)
  const BATCH_SIZE = 50;
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toFetch.length / BATCH_SIZE);
    const pct = ((i / toFetch.length) * 100).toFixed(0);

    console.log(
      `Batch ${batchNum}/${totalBatches} (${pct}%) — ` +
      `${batch.length} tickers — ` +
      `✓ ${success} ✗ ${failed}`,
    );

    try {
      const quoteMap = await fetchEODQuotes(batch);
      const fetched = Object.keys(quoteMap).length;
      const missed = batch.filter((t) => !quoteMap[t]);
      success += fetched;
      failed += missed.length;
      for (const t of missed) {
        errors.push(`${t}: no data returned`);
      }
    } catch (err) {
      failed += batch.length;
      errors.push(`Batch ${batchNum}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n── Seed complete ──────────────────────");
  console.log(`✓ Seeded:  ${success}`);
  console.log(`↷ Skipped: ${skipped} (already cached)`);
  console.log(`✗ Failed:  ${failed}`);

  if (errors.length > 0) {
    console.log("\nFailed tickers:");
    errors.slice(0, 20).forEach((e) => console.log(`  ${e}`));
    if (errors.length > 20) {
      console.log(`  ...and ${errors.length - 20} more`);
    }
  }

  console.log("\nBreadth indicator is now active.");
  console.log("Run the nightly scan to see Layer 4 results.");
}

main().catch(console.error);
