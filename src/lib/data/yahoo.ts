/**
 * Yahoo Finance data fetching via yahoo-finance2.
 * Independent from any other project.
 */
import YahooFinance from "yahoo-finance2";

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
  const result = await yahooFinance.historical(symbol, {
    period1,
    period2: period2 ?? new Date(),
    interval: "1d",
    events: "history",
  });

  return result.map((bar) => ({
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    adjClose: bar.adjClose ?? bar.close,
    volume: bar.volume,
  }));
}

/**
 * Fetch a real-time quote snapshot.
 */
export async function fetchQuote(symbol: string) {
  return yahooFinance.quote(symbol);
}
