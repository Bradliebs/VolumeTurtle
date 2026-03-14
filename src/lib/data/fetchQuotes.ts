import YahooFinance from "yahoo-finance2";

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

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;
const MIN_DAYS = 25;
const LOOKBACK_DAYS = 60;

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
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - LOOKBACK_DAYS);

    const result = await yahooFinance.chart(ticker, {
      period1: start,
      period2: now,
      interval: "1d",
    });

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
    console.error(`[fetchEODQuotes] Failed to fetch ${ticker}:`, err);
    return null;
  }
}

/**
 * Fetch 60 days of daily OHLCV data for each ticker via yahoo-finance2 chart().
 * Batches requests in groups of 10 with a 500ms delay between batches.
 * Skips tickers that fail or return fewer than 25 days of data.
 */
export async function fetchEODQuotes(tickers: string[]): Promise<QuoteMap> {
  const result: QuoteMap = {};

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);

    const settled = await Promise.all(
      batch.map(async (ticker) => ({
        ticker,
        quotes: await fetchSingle(ticker),
      })),
    );

    for (const { ticker, quotes } of settled) {
      if (quotes && quotes.length >= MIN_DAYS) {
        result[ticker] = quotes;
      }
    }

    const hasMore = i + BATCH_SIZE < tickers.length;
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
