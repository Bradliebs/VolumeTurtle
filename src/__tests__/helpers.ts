import type { DailyQuote } from "@/lib/data/fetchQuotes";

/**
 * Generate N days of synthetic OHLCV data.
 * Prices start at `basePrice` and jitter by ±spread.
 */
export function generateQuotes(
  n: number,
  opts: {
    basePrice?: number;
    spread?: number;
    baseVolume?: number;
    startDate?: string;
  } = {},
): DailyQuote[] {
  const {
    basePrice = 100,
    spread = 2,
    baseVolume = 1_000_000,
    startDate = "2025-01-01",
  } = opts;

  const quotes: DailyQuote[] = [];
  const start = new Date(startDate);

  for (let i = 0; i < n; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);

    const close = basePrice + (i % 3 === 0 ? spread : i % 3 === 1 ? -spread : 0);
    const high = close + spread;
    const low = close - spread;
    const open = close - spread / 2;

    quotes.push({
      date: dateStr,
      open,
      high,
      low,
      close,
      volume: baseVolume,
    });
  }

  return quotes;
}

/**
 * Build a single quote with explicit values.
 */
export function makeQuote(overrides: Partial<DailyQuote> & { date: string }): DailyQuote {
  return {
    open: 100,
    high: 110,
    low: 90,
    close: 105,
    volume: 1_000_000,
    ...overrides,
  };
}
