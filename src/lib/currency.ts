/**
 * Currency symbol lookup by ticker suffix.
 * Used for display formatting only — does not affect calculation.
 */

const SUFFIX_CURRENCY: Record<string, string> = {
  ".L": "£",    // LSE — GBP
  ".AS": "€",   // Amsterdam — EUR
  ".HE": "€",   // Helsinki — EUR
  ".ST": "kr",  // Stockholm — SEK
  ".CO": "kr",  // Copenhagen — DKK
};

export function getCurrencySymbol(ticker: string): string {
  for (const [suffix, symbol] of Object.entries(SUFFIX_CURRENCY)) {
    if (ticker.endsWith(suffix)) return symbol;
  }
  return "$"; // Default — US tickers
}

/**
 * Returns true if the ticker is denominated in a non-GBP currency
 * that needs FX conversion for a GBP-based account.
 */
export function isUsdTicker(ticker: string): boolean {
  return !ticker.endsWith(".L") && !ticker.endsWith(".AS") &&
    !ticker.endsWith(".HE") && !ticker.endsWith(".ST") && !ticker.endsWith(".CO");
}

// ── GBP/USD rate cache ──

let cachedRate: { rate: number; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 3600_000; // 1 hour
const FALLBACK_RATE = 1.27;

/**
 * Fetch the current GBP/USD exchange rate.
 * Caches for 1 hour. Falls back to 1.27 if fetch fails.
 */
export async function getGbpUsdRate(): Promise<number> {
  if (cachedRate && Date.now() - cachedRate.fetchedAt < CACHE_TTL_MS) {
    return cachedRate.rate;
  }
  try {
    const YahooFinance = (await import("yahoo-finance2")).default;
    const yf = new YahooFinance();
    const quote = await yf.quote("GBPUSD=X");
    const rate = quote?.regularMarketPrice ?? FALLBACK_RATE;
    cachedRate = { rate, fetchedAt: Date.now() };
    return rate;
  } catch {
    return cachedRate?.rate ?? FALLBACK_RATE;
  }
}

// ── GBP/EUR rate cache ──

let cachedEurRate: { rate: number; fetchedAt: number } | null = null;
const FALLBACK_EUR_RATE = 1.17;

/**
 * Fetch the current GBP/EUR exchange rate.
 * Caches for 1 hour. Falls back to 1.17 if fetch fails.
 */
export async function getGbpEurRate(): Promise<number> {
  if (cachedEurRate && Date.now() - cachedEurRate.fetchedAt < CACHE_TTL_MS) {
    return cachedEurRate.rate;
  }
  try {
    const YahooFinance = (await import("yahoo-finance2")).default;
    const yf = new YahooFinance();
    const quote = await yf.quote("GBPEUR=X");
    const rate = quote?.regularMarketPrice ?? FALLBACK_EUR_RATE;
    cachedEurRate = { rate, fetchedAt: Date.now() };
    return rate;
  } catch {
    return cachedEurRate?.rate ?? FALLBACK_EUR_RATE;
  }
}

/**
 * Returns true if the ticker is a EUR-denominated stock.
 */
export function isEurTicker(ticker: string): boolean {
  return ticker.endsWith(".AS") || ticker.endsWith(".HE");
}

/**
 * Convert a foreign-currency amount to GBP using the given rates.
 */
export function convertToGbp(amount: number, ticker: string, gbpUsdRate: number, gbpEurRate?: number): number {
  if (ticker.endsWith(".L")) return amount; // Already GBP
  if (isEurTicker(ticker) && gbpEurRate) return amount / gbpEurRate;
  if (isUsdTicker(ticker)) return amount / gbpUsdRate;
  return amount; // SEK/DKK — small portion, not converted
}
