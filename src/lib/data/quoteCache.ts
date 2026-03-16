import { prisma } from "@/db/client";
import type { DailyQuote } from "@/lib/data/fetchQuotes";

/**
 * Load cached daily quotes for a ticker from the database.
 * Returns quotes sorted oldest to newest.
 */
export async function getCachedQuotes(
  symbol: string,
  since: Date,
): Promise<DailyQuote[]> {
  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) return [];

  const rows = await prisma.dailyQuote.findMany({
    where: {
      tickerId: ticker.id,
      date: { gte: since },
    },
    orderBy: { date: "asc" },
  });

  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: Number(r.volume),
  }));
}

/**
 * Get the most recent cached date for a ticker, or null if none.
 */
export async function getLatestCachedDate(symbol: string): Promise<Date | null> {
  const ticker = await prisma.ticker.findUnique({ where: { symbol } });
  if (!ticker) return null;

  const latest = await prisma.dailyQuote.findFirst({
    where: { tickerId: ticker.id },
    orderBy: { date: "desc" },
    select: { date: true },
  });

  return latest?.date ?? null;
}

/**
 * Upsert daily quotes into the cache for a ticker.
 * Creates the Ticker record if it doesn't exist.
 */
export async function cacheQuotes(
  symbol: string,
  quotes: DailyQuote[],
): Promise<void> {
  if (quotes.length === 0) return;

  const ticker = await prisma.ticker.upsert({
    where: { symbol },
    create: { symbol },
    update: {},
  });

  // Use a transaction for batch upsert
  const operations = quotes.map((q) =>
    prisma.dailyQuote.upsert({
      where: {
        tickerId_date: {
          tickerId: ticker.id,
          date: new Date(q.date),
        },
      },
      create: {
        tickerId: ticker.id,
        date: new Date(q.date),
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        adjClose: q.close,
        volume: BigInt(Math.round(q.volume)),
      },
      update: {
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        adjClose: q.close,
        volume: BigInt(Math.round(q.volume)),
      },
    }),
  );

  await prisma.$transaction(operations);
}
