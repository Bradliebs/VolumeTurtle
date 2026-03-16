/**
 * Yahoo Finance data fetching via yahoo-finance2.
 * Independent from any other project.
 */
import YahooFinance from "yahoo-finance2";
import { withRetry } from "@/lib/retry";

const yahooFinance = new YahooFinance();

export interface HistoricalBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  adjClose: number;
  volume: number;
}

/**
 * Fetch historical daily bars for a ticker.
 */
export async function fetchHistory(
  symbol: string,
  period1: Date,
  period2?: Date,
): Promise<HistoricalBar[]> {
  try {
    const result = await withRetry(
      () => yahooFinance.historical(symbol, {
        period1,
        period2: period2 ?? new Date(),
        interval: "1d",
        events: "history",
      }),
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        onRetry: (err, attempt, delay) => {
          console.warn(`[yahoo] Retry ${attempt} for ${symbol} history in ${Math.round(delay)}ms:`, err instanceof Error ? err.message : err);
        },
      },
    );

    return result.map((bar) => ({
      date: bar.date,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      adjClose: bar.adjClose ?? bar.close,
      volume: bar.volume,
    }));
  } catch (err) {
    console.error(`[yahoo] Failed to fetch history for ${symbol} after retries:`, err);
    return [];
  }
}

/**
 * Fetch a real-time quote snapshot.
 */
export async function fetchQuote(symbol: string) {
  try {
    return await withRetry(
      () => yahooFinance.quote(symbol),
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        onRetry: (err, attempt, delay) => {
          console.warn(`[yahoo] Retry ${attempt} for ${symbol} quote in ${Math.round(delay)}ms:`, err instanceof Error ? err.message : err);
        },
      },
    );
  } catch (err) {
    console.error(`[yahoo] Failed to fetch quote for ${symbol} after retries:`, err);
    return null;
  }
}
