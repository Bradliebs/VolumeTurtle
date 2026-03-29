import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { loadT212Settings, updateStopOnT212, getPositionsWithStopsMapped } from "@/lib/t212/client";
import { enforceMonotonicStop } from "@/lib/trades/utils";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/t212/stops");

/**
 * POST /api/t212/stops/[id]
 *
 * Push the current stop for a trade to Trading 212.
 * Monotonic enforcement: the stop sent to T212 can only be >= the trade's
 * current stored stop. If a lower value is somehow requested, it is
 * silently raised to the current stop.
 *
 * Body (optional):
 *   { stopPrice?: number }  — override stop price (still monotonic-guarded)
 *
 * If no body, uses the trade's current active stop (max of hardStop, trailingStop).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Rate limit: max 5 T212 stop pushes per minute
  const limited = rateLimit(getRateLimitKey(request), 5, 60_000);
  if (limited) return limited;

  try {
    const { id } = await params;

    // Load T212 settings
    const t212Settings = loadT212Settings();
    if (!t212Settings) {
      return NextResponse.json(
        { error: "Trading 212 is not configured" },
        { status: 400 },
      );
    }

    // Load trade
    const trade = await prisma.trade.findUnique({ where: { id } });
    if (!trade) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }
    if (trade.status !== "OPEN") {
      return NextResponse.json({ error: "Trade is not open" }, { status: 400 });
    }

    // Determine stop price
    const currentStop = Math.max(trade.hardStop, trade.trailingStop);
    let requestedStop = currentStop;

    // Allow body override, but enforce monotonic
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = await request.json();
        if (typeof body.stopPrice === "number" && body.stopPrice > 0) {
          requestedStop = body.stopPrice;
        }
      } catch {
        // No body or invalid JSON — use current stop
      }
    }

    // MONOTONIC ENFORCEMENT: stop can only go up
    const effectiveStop = enforceMonotonicStop(requestedStop, currentStop);

    // T212 FLOOR: check if T212 already has a higher stop
    let t212CurrentStop: number | null = null;
    try {
      const positions = await getPositionsWithStopsMapped(t212Settings);
      const t212Pos = positions.find((p) => p.ticker === trade.ticker);
      t212CurrentStop = t212Pos?.stopLoss ?? null;
    } catch {
      // If we can't check T212, proceed with the push
    }

    if (t212CurrentStop != null && effectiveStop < t212CurrentStop - 0.01) {
      log.warn({ ticker: trade.ticker, computed: effectiveStop, t212Stop: t212CurrentStop }, "Blocked push — would downgrade T212 stop");
      return NextResponse.json({
        error: `Computed stop $${effectiveStop.toFixed(2)} is below T212 stop $${t212CurrentStop.toFixed(2)} — push would downgrade your stop`,
        t212Stop: t212CurrentStop,
        computedStop: effectiveStop,
      }, { status: 409 });
    }

    if (t212CurrentStop != null && effectiveStop <= t212CurrentStop + 0.01) {
      return NextResponse.json({
        success: true,
        ticker: trade.ticker,
        stopPrice: t212CurrentStop,
        message: `T212 stop already at $${t212CurrentStop.toFixed(2)}, no update needed`,
        cancelledOrderId: null,
        newOrderId: null,
        actionedStopHistoryId: null,
      });
    }

    // Push to T212
    const result = await updateStopOnT212(
      t212Settings,
      trade.ticker,
      trade.shares,
      effectiveStop,
    );

    // Mark stop as actioned in the most recent unactioned stop history
    const unactioned = await prisma.stopHistory.findFirst({
      where: { tradeId: id, changed: true, actioned: false },
      orderBy: { date: "desc" },
    });
    if (unactioned) {
      await prisma.stopHistory.update({
        where: { id: unactioned.id },
        data: { actioned: true, actionedAt: new Date() },
      });
    }

    log.info(
      { ticker: trade.ticker, stop: effectiveStop, cancelled: result.cancelled },
      "Stop pushed to T212",
    );

    return NextResponse.json({
      success: true,
      ticker: trade.ticker,
      stopPrice: effectiveStop,
      cancelledOrderId: result.cancelled,
      newOrderId: result.placed.id,
      actionedStopHistoryId: unactioned?.id ?? null,
    });
  } catch (err) {
    log.error({ err }, "Failed to push stop to T212");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update stop on T212" },
      { status: 500 },
    );
  }
}
