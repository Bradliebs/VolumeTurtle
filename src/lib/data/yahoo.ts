/**
 * Yahoo Finance data fetching via yahoo-finance2.
 * Independent from any other project.
 */
import YahooFinance from "yahoo-finance2";
import { withRetry } from "@/lib/retry";
import { createLogger } from "@/lib/logger";

const log = createLogger("yahoo");
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

export interface FetchHistoryResult {
  data: HistoricalBar[];
  error: string | null;
}

/**
 * Fetch historical daily bars for a ticker.
 * Returns { data, error } so callers can distinguish "no data available"
 * (data=[], error=null) from "fetch failed" (data=[], error=message).
 */
export async function fetchHistory(
  symbol: string,
  period1: Date,
  period2?: Date,
): Promise<FetchHistoryResult> {
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
          log.warn({ symbol, attempt, delayMs: Math.round(delay) }, "Retrying history fetch");
        },
      },
    );

    return {
      data: result.map((bar) => ({
        date: bar.date,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        adjClose: bar.adjClose ?? bar.close,
        volume: bar.volume,
      })),
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ symbol, err }, "Failed to fetch history after retries");
    return { data: [], error: message };
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
          log.warn({ symbol, attempt, delayMs: Math.round(delay) }, "Retrying quote fetch");
        },
      },
    );
  } catch (err) {
    log.error({ symbol, err }, "Failed to fetch quote after retries");
    return null;
  }
}
