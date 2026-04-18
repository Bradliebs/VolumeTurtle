// Backfill historical daily OHLCV quotes for every active ticker so backtests
// can run over multi-year windows. The standard nightly fetch only pulls a
// rolling LOOKBACK_DAYS window (~60 days), which is fine for live signals but
// catastrophic for any backtest window > a few months — CAGR gets annualised
// from a tiny slice and produces nonsense.
//
// Usage:
//   npx tsx scripts/backfillQuotes.ts                 # default 2 years
//   npx tsx scripts/backfillQuotes.ts --years=5
//   npx tsx scripts/backfillQuotes.ts --years=2 --concurrency=8 --delay=400
//   npx tsx scripts/backfillQuotes.ts --tickers=AAPL,MSFT,HBR.L
//   npx tsx scripts/backfillQuotes.ts --skip-if-rows=400  # skip tickers already
//                                                          # with >=400 rows in window

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import YahooFinance from "yahoo-finance2";
import { withRetry } from "../src/lib/retry";

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });
const prisma = new PrismaClient({ adapter });
const yahoo = new YahooFinance();

interface Args {
  years: number;
  concurrency: number;
  delayMs: number;
  tickers: string[] | null;
  skipIfRows: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const years = Number(get("years") ?? 2);
  const concurrency = Number(get("concurrency") ?? 6);
  const delayMs = Number(get("delay") ?? 500);
  const tickersArg = get("tickers");
  const skipIfRows = Number(get("skip-if-rows") ?? 0);
  return {
    years: Number.isFinite(years) && years > 0 ? years : 2,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 6,
    delayMs: Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 500,
    tickers: tickersArg ? tickersArg.split(",").map((s) => s.trim()).filter(Boolean) : null,
    skipIfRows: Number.isFinite(skipIfRows) && skipIfRows > 0 ? skipIfRows : 0,
  };
}

function isPenceQuoted(ticker: string): boolean {
  return ticker.endsWith(".L");
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface FetchOk {
  ok: true;
  inserted: number;
  earliest: string;
  latest: string;
}
interface FetchSkip { ok: false; reason: string }
type FetchResult = FetchOk | FetchSkip;

async function backfillTicker(
  symbol: string,
  tickerId: number,
  start: Date,
  end: Date,
  skipIfRows: number,
): Promise<FetchResult> {
  if (skipIfRows > 0) {
    const existing = await (prisma as unknown as {
      dailyQuote: { count: (a: unknown) => Promise<number> };
    }).dailyQuote.count({
      where: { tickerId, date: { gte: start, lte: end } },
    });
    if (existing >= skipIfRows) {
      return { ok: false, reason: `already has ${existing} rows` };
    }
  }

  let chart;
  try {
    chart = await withRetry(
      () => yahoo.chart(symbol, { period1: start, period2: end, interval: "1d" }),
      {
        maxAttempts: 3,
        baseDelayMs: 1500,
      },
    );
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const quotes = chart.quotes ?? [];
  if (quotes.length === 0) return { ok: false, reason: "no data returned" };

  const divisor = isPenceQuoted(symbol) ? 100 : 1;
  const rows = quotes
    .filter((q) => q.open != null && q.high != null && q.low != null && q.close != null && q.volume != null)
    .map((q) => {
      const close = q.close! / divisor;
      return {
        tickerId,
        date: q.date,
        open: q.open! / divisor,
        high: q.high! / divisor,
        low: q.low! / divisor,
        close,
        // Schema requires adjClose; chart() doesn't reliably populate it,
        // so use raw close as the live cache layer does (quoteCache.ts).
        adjClose: close,
        volume: BigInt(q.volume!),
      };
    });

  if (rows.length === 0) return { ok: false, reason: "all rows null" };

  // createMany with skipDuplicates is dramatically faster than per-row upsert
  // for backfill volume. The unique [tickerId, date] index handles dedup.
  const created = await (prisma as unknown as {
    dailyQuote: { createMany: (a: unknown) => Promise<{ count: number }> };
  }).dailyQuote.createMany({ data: rows, skipDuplicates: true });

  return {
    ok: true,
    inserted: created.count,
    earliest: rows[0]!.date.toISOString().slice(0, 10),
    latest: rows[rows.length - 1]!.date.toISOString().slice(0, 10),
  };
}

async function main() {
  const args = parseArgs();
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - args.years);

  console.log(`Backfill window: ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)} (${args.years}y)`);
  console.log(`Concurrency: ${args.concurrency}, batch delay: ${args.delayMs}ms`);
  if (args.skipIfRows > 0) console.log(`Skip threshold: ${args.skipIfRows} existing rows`);

  const where: Record<string, unknown> = args.tickers
    ? { symbol: { in: args.tickers } }
    : { active: true };
  const tickers = await (prisma as unknown as {
    ticker: { findMany: (a: unknown) => Promise<Array<{ id: number; symbol: string }>> };
  }).ticker.findMany({ where, orderBy: { symbol: "asc" } });

  console.log(`Tickers to process: ${tickers.length}`);
  if (tickers.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  let totalInserted = 0;
  const t0 = Date.now();

  for (let i = 0; i < tickers.length; i += args.concurrency) {
    const batch = tickers.slice(i, i + args.concurrency);
    const results = await Promise.all(
      batch.map((t) => backfillTicker(t.symbol, t.id, start, end, args.skipIfRows)),
    );

    for (let j = 0; j < batch.length; j++) {
      const t = batch[j]!;
      const r = results[j]!;
      if (r.ok) {
        ok++;
        totalInserted += r.inserted;
        console.log(`  [${(i + j + 1).toString().padStart(4)}/${tickers.length}] ${t.symbol.padEnd(10)} +${r.inserted.toString().padStart(4)} rows  ${r.earliest} → ${r.latest}`);
      } else if (r.reason.startsWith("already has")) {
        skipped++;
        if (skipped <= 5 || skipped % 50 === 0) {
          console.log(`  [${(i + j + 1).toString().padStart(4)}/${tickers.length}] ${t.symbol.padEnd(10)} SKIP   (${r.reason})`);
        }
      } else {
        failed++;
        console.log(`  [${(i + j + 1).toString().padStart(4)}/${tickers.length}] ${t.symbol.padEnd(10)} FAIL   (${r.reason})`);
      }
    }

    if (i + args.concurrency < tickers.length) await sleep(args.delayMs);
  }

  const seconds = Math.round((Date.now() - t0) / 1000);
  console.log("\nBackfill complete:");
  console.log(`  ${ok} succeeded, ${skipped} skipped, ${failed} failed`);
  console.log(`  ${totalInserted.toLocaleString()} rows inserted`);
  console.log(`  Wall time: ${Math.floor(seconds / 60)}m ${seconds % 60}s`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
