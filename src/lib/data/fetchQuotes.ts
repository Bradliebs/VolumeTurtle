import YahooFinance from "yahoo-finance2";
import { withRetry } from "@/lib/retry";
import { getCachedQuotes, cacheQuotes, getLatestCachedDate } from "@/lib/data/quoteCache";
import { createLogger } from "@/lib/logger";
import { config } from "@/lib/config";

const log = createLogger("fetchQuotes");
const yahooFinance = new YahooFinance();

export interface DailyQuote {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type QuoteMap = Record<string, DailyQuote[]>;

const BATCH_SIZE = config.quoteBatchSize;
const BATCH_DELAY_MS = config.quoteBatchDelayMs;
const MIN_DAYS = 25;
const LOOKBACK_DAYS = config.quoteLookbackDays;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Yahoo Finance returns LSE (.L) prices in pence (GBp).
 * Convert to pounds by dividing OHLC by 100. Volume stays unchanged.
 */
function isPenceQuoted(ticker: string): boolean {
  return ticker.endsWith(".L");
}

async function fetchSingle(ticker: string): Promise<DailyQuote[] | null> {
  try {
    const result = await withRetry(
      async () => {
        const now = new Date();
        const start = new Date();
        start.setDate(now.getDate() - LOOKBACK_DAYS);
        return yahooFinance.chart(ticker, {
          period1: start,
          period2: now,
          interval: "1d",
        });
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        onRetry: (err, attempt, delay) => {
          log.warn({ ticker, attempt, delayMs: Math.round(delay) }, "Retrying Yahoo Finance fetch");
        },
      },
    );

    const quotes = result.quotes;
    if (!quotes || quotes.length === 0) return null;

    const pence = isPenceQuoted(ticker);
    const divisor = pence ? 100 : 1;

    const mapped: DailyQuote[] = [];
    for (const q of quotes) {
      if (
        q.open == null ||
        q.high == null ||
        q.low == null ||
        q.close == null ||
        q.volume == null
      )
        continue;
      mapped.push({
        date: formatDate(q.date),
        open: q.open / divisor,
        high: q.high / divisor,
        low: q.low / divisor,
        close: q.close / divisor,
        volume: q.volume,
      });
    }
    return mapped.length > 0 ? mapped : null;
  } catch (err) {
    log.error({ ticker, err }, "Failed to fetch after retries");
    return null;
  }
}

/**
 * Fetch 60 days of daily OHLCV data for each ticker.
 * Uses the database cache first, only fetching missing dates from Yahoo Finance.
 * Batches API requests in groups of 10 with a 500ms delay between batches.
 * Skips tickers that fail or return fewer than 25 days of data.
 */
export async function fetchEODQuotes(tickers: string[]): Promise<QuoteMap> {
  const result: QuoteMap = {};
  const tickersToFetch: string[] = [];

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  // Phase 1: Check cache for each ticker
  for (const ticker of tickers) {
    try {
      const latestCached = await getLatestCachedDate(ticker);
      const now = new Date();
      const today = now.toISOString().slice(0, 10);

      if (latestCached && latestCached.toISOString().slice(0, 10) === today) {
        // Cache has today's bar — only trust it after all markets close (23:00 UTC)
        // to avoid caching partial intraday bars from Yahoo Finance
        const afterAllMarketsClose = now.getUTCHours() >= 23;
        if (afterAllMarketsClose) {
          const cached = await getCachedQuotes(ticker, since);
          if (cached.length >= MIN_DAYS) {
            result[ticker] = cached;
            continue;
          }
        }
      } else if (latestCached) {
        // Cache has yesterday's (or older) bar — use if today is a non-trading day
        // (weekends/holidays), otherwise re-fetch to check for today's bar
        const isWeekend = now.getUTCDay() === 0 || now.getUTCDay() === 6;
        const cachedYesterday = new Date(now);
        cachedYesterday.setDate(cachedYesterday.getDate() - 1);
        const latestIsFresh = latestCached.toISOString().slice(0, 10) >= cachedYesterday.toISOString().slice(0, 10);
        if (isWeekend && latestIsFresh) {
          const cached = await getCachedQuotes(ticker, since);
          if (cached.length >= MIN_DAYS) {
            result[ticker] = cached;
            continue;
          }
        }
      }
    } catch {
      // Cache miss — fetch from API
    }
    tickersToFetch.push(ticker);
  }

  // Phase 2: Fetch missing tickers from Yahoo Finance in batches
  for (let i = 0; i < tickersToFetch.length; i += BATCH_SIZE) {
    const batch = tickersToFetch.slice(i, i + BATCH_SIZE);

    const settled = await Promise.all(
      batch.map(async (ticker) => ({
        ticker,
        quotes: await fetchSingle(ticker),
      })),
    );

    for (const { ticker, quotes } of settled) {
      if (quotes && quotes.length >= MIN_DAYS) {
        result[ticker] = quotes;

        // Store in cache (fire-and-forget to avoid blocking)
        cacheQuotes(ticker, quotes).catch((err) => {
          log.warn({ ticker, err: err instanceof Error ? err.message : err }, "Failed to cache quotes");
        });
      }
    }

    const hasMore = i + BATCH_SIZE < tickersToFetch.length;
    if (hasMore) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return result;
}

/**
 * Return the most recent N days of quotes, sorted oldest to newest.
 */
export function getLastNDays(quotes: DailyQuote[], n: number): DailyQuote[] {
  return quotes.slice(-n);
}
