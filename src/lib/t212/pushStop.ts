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
import { sendTelegram } from "@/lib/telegram";
import { prisma } from "@/db/client";

const log = createLogger("pushStop");

const db = prisma as unknown as {
  alert: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PushStopResult {
  success: boolean;
  stopPrice: number;
  cancelledOrderId: number | null;
  placedOrder: T212Order | null;
  restored?: boolean;
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

    // Cancel any existing stop order for this ticker — store old stop for recovery
    let cancelledOrderId: number | null = null;
    let oldStopPrice: number | null = null;
    try {
      const orders = await getPendingOrders(t212Settings);
      const existing = orders.find(
        (o) =>
          o.ticker.toUpperCase() === t212Ticker.toUpperCase() &&
          (o.type?.toUpperCase().includes("STOP") ?? false),
      );
      if (existing) {
        oldStopPrice = (existing as unknown as Record<string, unknown>)["stopPrice"] as number | null;
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
    let placed: T212Order;
    try {
      placed = await placeStopOrder(
        t212Settings,
        t212Ticker,
        quantity,
        stopPrice,
      );
    } catch (placeErr) {
      const placeErrMsg = placeErr instanceof Error ? placeErr.message : String(placeErr);
      log.error({ ticker: yahooTicker, error: placeErrMsg }, "Stop placement failed after cancel");

      // Attempt to restore the old stop if cancel had succeeded
      if (cancelledOrderId !== null && oldStopPrice !== null) {
        try {
          await sleep(2500);
          await placeStopOrder(t212Settings, t212Ticker, quantity, oldStopPrice);
          log.info(
            { ticker: yahooTicker, restoredPrice: oldStopPrice },
            "Stop restoration SUCCESS — old stop restored after failed update",
          );
          return {
            success: false,
            stopPrice: stopPriceGBP,
            cancelledOrderId,
            placedOrder: null,
            restored: true,
            error: `Place failed, old stop restored at ${isPence ? oldStopPrice / 100 : oldStopPrice}`,
          };
        } catch (restoreErr) {
          log.error(
            { ticker: yahooTicker, error: String(restoreErr) },
            "Stop restoration ALSO failed — CRITICAL: no stop order active",
          );
        }
      }

      // Restoration failed or not possible — CRITICAL: no stop in place
      try {
        await db.alert.create({
          data: {
            type: "STOP_PUSH_FAILED",
            ticker: yahooTicker,
            message: `Stop push AND restoration failed — ${yahooTicker} has NO stop order in T212. Set manually at ${stopPriceGBP}`,
            acknowledged: false,
            createdAt: new Date(),
          },
        });
      } catch { /* best effort */ }

      try {
        await sendTelegram({
          text:
            `<b>🚨 CRITICAL — NO STOP ORDER</b>\n` +
            `<code>${yahooTicker}</code>\n` +
            `Cancel succeeded but place failed.\n` +
            `Restoration also failed.\n` +
            `<b>SET STOP MANUALLY AT ${stopPriceGBP}</b>`,
        });
      } catch { /* best effort */ }

      return {
        success: false,
        stopPrice: stopPriceGBP,
        cancelledOrderId,
        placedOrder: null,
        error: `Place failed, restoration failed — NO STOP ACTIVE: ${placeErrMsg}`,
      };
    }

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
