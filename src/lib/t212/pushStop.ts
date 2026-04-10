/**
 * Shared stop-push utility — single source of truth for pushing
 * a stop-loss to T212. Used by both:
 *   Layer 1: autoExecutor (immediately after fill)
 *   Layer 2: cruise daemon (hourly retry for unprotected positions)
 *
 * Handles: instrument lookup, GBX→pence conversion, cancel existing
 * stop, place new stop, return structured result.
 */

import {
  loadT212Settings,
  placeStopOrder,
  cancelOrder,
  getPendingOrders,
  getInstruments,
  yahooToT212Ticker,
  type T212Settings,
  type T212Instrument,
  type T212Order,
} from "@/lib/t212/client";
import { createLogger } from "@/lib/logger";

const log = createLogger("pushStop");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PushStopResult {
  success: boolean;
  stopPrice: number;
  cancelledOrderId: number | null;
  placedOrder: T212Order | null;
  error: string | null;
}

/**
 * Push a stop-loss order to T212 for a Yahoo-style ticker.
 *
 * @param yahooTicker  e.g. "HBR.L", "AAPL"
 * @param quantity     number of shares (positive)
 * @param stopPriceGBP stop price in the display currency (GBP for .L, USD for US)
 * @param settings     optional — loaded from env if omitted
 */
export async function pushStopToT212(
  yahooTicker: string,
  quantity: number,
  stopPriceGBP: number,
  settings?: T212Settings | null,
): Promise<PushStopResult> {
  const t212Settings = settings ?? loadT212Settings();
  if (!t212Settings) {
    return {
      success: false,
      stopPrice: stopPriceGBP,
      cancelledOrderId: null,
      placedOrder: null,
      error: "T212 settings not configured",
    };
  }

  try {
    const instruments = await getInstruments(t212Settings);
    const t212Ticker = yahooToT212Ticker(yahooTicker, instruments);
    if (!t212Ticker) {
      return {
        success: false,
        stopPrice: stopPriceGBP,
        cancelledOrderId: null,
        placedOrder: null,
        error: `No T212 instrument found for ${yahooTicker}`,
      };
    }

    // GBX conversion: if instrument is pence-denominated, multiply by 100
    const inst = instruments.find((i: T212Instrument) => i.ticker === t212Ticker);
    const isPence = inst?.currencyCode === "GBX";
    const stopPrice = isPence ? stopPriceGBP * 100 : stopPriceGBP;

    // Cancel any existing stop order for this ticker
    let cancelledOrderId: number | null = null;
    try {
      const orders = await getPendingOrders(t212Settings);
      const existing = orders.find(
        (o) =>
          o.ticker.toUpperCase() === t212Ticker.toUpperCase() &&
          (o.type?.toUpperCase().includes("STOP") ?? false),
      );
      if (existing) {
        await cancelOrder(t212Settings, existing.id);
        cancelledOrderId = existing.id;
        await sleep(2500); // T212 rate limit buffer after cancel
      }
    } catch (cancelErr) {
      log.warn(
        { ticker: yahooTicker, error: String(cancelErr) },
        "Failed to cancel existing stop — proceeding with new placement",
      );
    }

    // Place new stop order
    const placed = await placeStopOrder(
      t212Settings,
      t212Ticker,
      quantity,
      stopPrice,
    );

    log.info(
      { ticker: yahooTicker, t212Ticker, stopPrice: stopPriceGBP, isPence },
      "Stop pushed to T212",
    );

    return {
      success: true,
      stopPrice: stopPriceGBP,
      cancelledOrderId,
      placedOrder: placed,
      error: null,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error({ ticker: yahooTicker, error: errMsg }, "Stop push failed");
    return {
      success: false,
      stopPrice: stopPriceGBP,
      cancelledOrderId: null,
      placedOrder: null,
      error: errMsg,
    };
  }
}
