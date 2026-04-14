/**
 * Cross-validate extreme price moves via secondary data sources.
 * Used by dataValidator.ts when a ticker shows >25% daily change.
 *
 * Tries Alpha Vantage → Polygon.io → falls back to "unverified".
 */
import { createLogger } from "@/lib/logger";

const log = createLogger("crossValidator");

const ALPHA_VANTAGE_KEY = process.env["ALPHA_VANTAGE_KEY"] ?? "";
const POLYGON_KEY = process.env["POLYGON_KEY"] ?? "";

const MOVE_TOLERANCE = 0.05; // 5% tolerance for confirmation

export interface CrossValidationResult {
  confirmed: boolean;
  source: string;
  price?: number;
}

async function tryAlphaVantage(
  ticker: string,
  expectedMove: number,
): Promise<CrossValidationResult | null> {
  if (!ALPHA_VANTAGE_KEY) return null;

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${ALPHA_VANTAGE_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;

    const data = await res.json() as Record<string, Record<string, string>>;
    const gq = data["Global Quote"];
    if (!gq) return null;

    const price = parseFloat(gq["05. price"] ?? "");
    const prevClose = parseFloat(gq["08. previous close"] ?? "");
    if (isNaN(price) || isNaN(prevClose) || prevClose === 0) return null;

    const actualMove = (price - prevClose) / prevClose;
    const confirmed = Math.abs(actualMove - expectedMove) < MOVE_TOLERANCE;

    log.info(
      { ticker, expectedMove: (expectedMove * 100).toFixed(1), actualMove: (actualMove * 100).toFixed(1), confirmed },
      "Alpha Vantage cross-validation",
    );

    return { confirmed, source: "alphavantage", price };
  } catch (err) {
    log.warn({ ticker, err }, "Alpha Vantage cross-validation failed");
    return null;
  }
}

async function tryPolygon(
  ticker: string,
  expectedMove: number,
): Promise<CrossValidationResult | null> {
  if (!POLYGON_KEY) return null;

  try {
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?apiKey=${POLYGON_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;

    const data = await res.json() as { results?: Array<{ c: number; o: number }> };
    const result = data.results?.[0];
    if (!result || !result.c || !result.o) return null;

    // Polygon prev endpoint returns previous day's bar
    const prevClose = result.c;
    const open = result.o;
    if (!prevClose || prevClose <= 0 || !open || open <= 0) {
      return { confirmed: false, source: "polygon" };
    }

    // Validate the move: compare Polygon's close-to-open change vs expected
    const actualMove = (open - prevClose) / prevClose;
    const difference = Math.abs(actualMove - expectedMove);
    const confirmed = difference < MOVE_TOLERANCE;

    log.info(
      {
        ticker,
        polygonPrevClose: prevClose,
        polygonOpen: open,
        actualMove: (actualMove * 100).toFixed(1),
        expectedMove: (expectedMove * 100).toFixed(1),
        confirmed,
      },
      "Polygon cross-validation",
    );

    return { confirmed, source: "polygon", price: prevClose };
  } catch (err) {
    log.warn({ ticker, err }, "Polygon cross-validation failed");
    return null;
  }
}

export async function crossValidateMove(
  ticker: string,
  expectedMove: number,
): Promise<CrossValidationResult> {
  // Try Alpha Vantage first
  const av = await tryAlphaVantage(ticker, expectedMove);
  if (av) return av;

  // Try Polygon.io as fallback
  const pg = await tryPolygon(ticker, expectedMove);
  if (pg) return pg;

  // Neither available
  if (!ALPHA_VANTAGE_KEY && !POLYGON_KEY) {
    log.warn(
      { ticker },
      "Cross-validation unavailable — ALPHA_VANTAGE_KEY and POLYGON_KEY not set. Ticker excluded as precaution.",
    );
  }

  return { confirmed: false, source: "unverified" };
}
