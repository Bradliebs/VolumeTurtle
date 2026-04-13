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
          log.warn({ symbol, attempt, delayMs: Math.round(delay) }, "Retrying history fetch");
        },
      },
    );

    return result.map((bar) => {
      const isLSE = symbol.endsWith(".L");
      const divisor = isLSE ? 100 : 1;
      return {
        date: bar.date,
        open: bar.open / divisor,
        high: bar.high / divisor,
        low: bar.low / divisor,
        close: bar.close / divisor,
        adjClose: (bar.adjClose ?? bar.close) / divisor,
        volume: bar.volume,
      };
    });
  } catch (err) {
    log.error({ symbol, err }, "Failed to fetch history after retries");
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
          log.warn({ symbol, attempt, delayMs: Math.round(delay) }, "Retrying quote fetch");
        },
      },
    );
  } catch (err) {
    log.error({ symbol, err }, "Failed to fetch quote after retries");
    return null;
  }
}
