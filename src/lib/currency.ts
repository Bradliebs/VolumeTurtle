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
