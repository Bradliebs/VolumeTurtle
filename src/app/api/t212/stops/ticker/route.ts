import { NextRequest, NextResponse } from "next/server";
import { loadT212Settings, updateStopOnT212, getPositionsWithStopsMapped } from "@/lib/t212/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/t212/stops/ticker");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST /api/t212/stops/ticker
 *
 * Push a stop to Trading 212 by ticker name + stop price.
 * Works for any T212 position (tracked or untracked).
 *
 * Body: { ticker: string, stopPrice: number }
 */
export async function POST(request: NextRequest) {
  const limited = rateLimit(getRateLimitKey(request), 5, 60_000);
  if (limited) return limited;

  try {
    const t212Settings = loadT212Settings();
    if (!t212Settings) {
      return NextResponse.json(
        { error: "Trading 212 is not configured" },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { ticker, stopPrice } = body;

    if (!ticker || typeof ticker !== "string") {
      return NextResponse.json({ error: "ticker is required" }, { status: 400 });
    }
    if (typeof stopPrice !== "number" || stopPrice <= 0) {
      return NextResponse.json({ error: "stopPrice must be a positive number" }, { status: 400 });
    }

    // Get the position's quantity from T212
    const positions = await getPositionsWithStopsMapped(t212Settings);
    const position = positions.find((p) => p.ticker === ticker);
    if (!position) {
      return NextResponse.json(
        { error: `No T212 position found for ${ticker}` },
        { status: 404 },
      );
    }

    // Monotonic enforcement: don't allow lowering an existing stop
    if (position.stopLoss != null && stopPrice < position.stopLoss - 0.01) {
      return NextResponse.json(
        { error: `T212 stop is already at ${position.stopLoss.toFixed(2)} which is higher than ${stopPrice.toFixed(2)} — no update needed` },
        { status: 400 },
      );
    }

    // If T212 stop is already at or above the requested level, nothing to do
    if (position.stopLoss != null && position.stopLoss >= stopPrice - 0.01) {
      return NextResponse.json({
        success: true,
        ticker,
        stopPrice: position.stopLoss,
        message: `T212 stop already at ${position.stopLoss.toFixed(2)}, no update needed`,
        cancelledOrderId: null,
        newOrderId: null,
      });
    }

    // Delay to respect T212 rate limits between position lookup and order placement
    await sleep(3000);

    const result = await updateStopOnT212(
      t212Settings,
      ticker,
      position.quantity,
      stopPrice,
    );

    log.info(
      { ticker, stop: stopPrice, cancelled: result.cancelled },
      "Stop pushed to T212 (by ticker)",
    );

    return NextResponse.json({
      success: true,
      ticker,
      stopPrice,
      cancelledOrderId: result.cancelled,
      newOrderId: result.placed.id,
    });
  } catch (err) {
    log.error({ err }, "Failed to push stop to T212 by ticker");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update stop on T212" },
      { status: 500 },
    );
  }
}
