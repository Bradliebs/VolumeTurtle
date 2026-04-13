/**
 * Cruise Control — T212 API Interactions
 *
 * Reads current prices and updates stop orders on T212.
 * Falls back to Yahoo Finance for pricing when T212 is unavailable.
 */

import {
  loadT212Settings,
  getCachedT212Positions,
  updateStopOnT212 as t212UpdateStop,
  type T212Settings,
  type T212Position,
} from "@/lib/t212/client";
import { fetchQuote } from "@/lib/data/yahoo";
import { createLogger } from "@/lib/logger";

const log = createLogger("cruise-control-t212");

// ── Types ───────────────────────────────────────────────────────────────────

export interface T212UpdateResult {
  success: boolean;
  ticker: string;
  oldStop: number | null;
  newStop: number;
  t212Response?: string;
  error?: string;
}

export interface ReconcileResult {
  matched: number;
  orphaned: string[]; // Tickers in T212 but not in DB
  ghost: string[];    // Tickers in DB as active but not in T212
}

// ── Price Fetching ──────────────────────────────────────────────────────────

/**
 * Get current mid-price for a ticker.
 * Primary: T212 cached positions. Fallback: Yahoo Finance real-time quote.
 */
export async function getCurrentPrice(ticker: string): Promise<number | null> {
  const settings = loadT212Settings();

  // Try T212 first
  if (settings) {
    try {
      const { positions } = await getCachedT212Positions(settings);
      const pos = positions.find(
        (p) => p.ticker.toUpperCase() === ticker.toUpperCase(),
      );
      if (pos?.currentPrice != null && pos.currentPrice > 0) {
        return pos.currentPrice;
      }
    } catch (err) {
      log.warn({ ticker, err: String(err) }, "T212 price fetch failed, falling back to Yahoo");
    }
  }

  // Fallback: Yahoo Finance
  try {
    const quote = await fetchQuote(ticker);
    if (quote?.regularMarketPrice != null && quote.regularMarketPrice > 0) {
      let price = quote.regularMarketPrice;
      // GBX (pence) → GBP conversion for LSE tickers
      if (ticker.endsWith(".L")) {
        price = price / 100;
      }
      return price;
    }
  } catch (err) {
    log.error({ ticker, err: String(err) }, "Yahoo price fetch also failed");
  }

  return null;
}

// ── Stop Updates ────────────────────────────────────────────────────────────

/**
 * Update the stop-loss order on T212 for a given ticker.
 * Uses the existing cancel-and-replace pattern from the codebase.
 */
export async function updateStopOnT212(
  ticker: string,
  shares: number,
  oldStop: number | null,
  newStopPrice: number,
): Promise<T212UpdateResult> {
  const settings = loadT212Settings();
  if (!settings) {
    return {
      success: false,
      ticker,
      oldStop,
      newStop: newStopPrice,
      error: "T212 not configured",
    };
  }

  try {
    const result = await t212UpdateStop(settings, ticker, shares, newStopPrice);
    const pctChange = oldStop && oldStop > 0
      ? (((newStopPrice - oldStop) / oldStop) * 100).toFixed(2)
      : "n/a";

    log.info(
      { ticker, oldStop, newStop: newStopPrice, pctChange },
      `[CRUISE-CONTROL] ${ticker} stop updated: ${oldStop?.toFixed(2) ?? "none"} → ${newStopPrice.toFixed(2)} (+${pctChange}%)`,
    );

    return {
      success: true,
      ticker,
      oldStop,
      newStop: newStopPrice,
      t212Response: JSON.stringify({ cancelled: result.cancelled, placedId: result.placed?.id }),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ ticker, err: errorMsg }, `[CRUISE-CONTROL] Failed to update stop on T212 for ${ticker}`);
    return {
      success: false,
      ticker,
      oldStop,
      newStop: newStopPrice,
      error: errorMsg,
    };
  }
}

// ── Position Fetching ───────────────────────────────────────────────────────

/**
 * Fetch all currently open positions from T212 (mapped to Yahoo tickers).
 */
export async function getOpenPositionsFromT212(): Promise<T212Position[]> {
  const settings = loadT212Settings();
  if (!settings) return [];

  try {
    const { positions } = await getCachedT212Positions(settings);
    return positions;
  } catch (err) {
    log.error({ err: String(err) }, "Failed to fetch T212 positions");
    return [];
  }
}

// ── Reconciliation ──────────────────────────────────────────────────────────

interface DbPosition {
  ticker: string;
  status: string;
}

/**
 * Compare T212 open positions against TradeCore database.
 * Flags orphaned (T212 only) and ghost (DB only) positions.
 * Does NOT automatically close anything — flags only.
 */
export function reconcilePositions(
  t212Positions: T212Position[],
  dbPositions: DbPosition[],
): ReconcileResult {
  const t212Tickers = new Set(
    t212Positions.map((p) => p.ticker.toUpperCase()),
  );
  const dbTickers = new Set(
    dbPositions
      .filter((p) => p.status === "OPEN")
      .map((p) => p.ticker.toUpperCase()),
  );

  const orphaned: string[] = [];
  const ghost: string[] = [];

  // Positions in T212 but not in DB
  for (const ticker of t212Tickers) {
    if (!dbTickers.has(ticker)) {
      orphaned.push(ticker);
      log.warn({ ticker }, "[CRUISE-CONTROL-WARN] Orphaned T212 position: not found in database");
    }
  }

  // Positions in DB as active but not in T212
  for (const ticker of dbTickers) {
    if (!t212Tickers.has(ticker)) {
      ghost.push(ticker);
      log.warn({ ticker }, "[CRUISE-CONTROL-WARN] Ghost position: in database but not in T212");
    }
  }

  const matched = [...t212Tickers].filter((t) => dbTickers.has(t)).length;

  return { matched, orphaned, ghost };
}
