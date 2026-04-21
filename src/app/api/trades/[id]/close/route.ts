import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { createLogger } from "@/lib/logger";
import { sendTelegram } from "@/lib/telegram";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import {
  loadT212Settings,
  getInstruments,
  yahooToT212Ticker,
  getPendingOrders,
  cancelOrder,
  placeMarketSellOrder,
  isT212Pence,
} from "@/lib/t212/client";

const log = createLogger("api/trades/:id/close");

const db = prisma as unknown as {
  trade: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
  };
  timeStopFlag: {
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isStopOrderType(type: string | undefined): boolean {
  if (!type) return false;
  return type.toUpperCase().includes("STOP");
}

/**
 * POST /api/trades/[id]/close
 *
 * Closes an open trade on T212 AND in the DB. Used by the autonomous agent.
 *
 * Flow (real-money safe):
 *   1. Look up trade + map ticker to T212 instrument
 *   2. Cancel any existing T212 stop order for this position
 *   3. Place market SELL order on T212 for full quantity
 *   4. Wait for confirmation
 *   5. Only on success → mark DB row CLOSED with the actual T212 fill price
 *
 * If T212 sell fails: DB is NOT touched. Returns 500 so the agent can retry/alert.
 *
 * Body: { agentReasoning?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = rateLimit(getRateLimitKey(request), 5, 60_000);
  if (limited) return limited;

  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const agentReasoning = (body["agentReasoning"] as string) ?? null;

    const trade = await db.trade.findUnique({ where: { id } } as unknown);
    if (!trade) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }
    if (trade["status"] === "CLOSED") {
      return NextResponse.json({ error: "Trade is already closed" }, { status: 400 });
    }

    const ticker = trade["ticker"] as string;
    const entryPrice = trade["entryPrice"] as number;
    const hardStop = trade["hardStop"] as number;
    const shares = trade["shares"] as number;

    // Same fallback chain as the ratchet engine — used only if T212 doesn't
    // report a fillPrice in the order response.
    const trailingStopPrice = trade["trailingStopPrice"] as number | null | undefined;
    const trailingStop = trade["trailingStop"] as number | null | undefined;
    const hardStopPrice = trade["hardStopPrice"] as number | null | undefined;
    const fallbackExitPrice =
      trailingStopPrice ?? trailingStop ?? hardStopPrice ?? hardStop;

    if (!Number.isFinite(shares) || shares <= 0) {
      return NextResponse.json(
        { error: `Trade has invalid share quantity: ${shares}` },
        { status: 400 },
      );
    }

    // ── Step 1: T212 settings + instrument lookup ──
    const t212Settings = loadT212Settings();
    if (!t212Settings) {
      return NextResponse.json(
        { error: "T212 not configured — cannot close on broker. DB not modified." },
        { status: 500 },
      );
    }

    const instruments = await getInstruments(t212Settings);
    const t212Ticker = yahooToT212Ticker(ticker, instruments);
    if (!t212Ticker) {
      return NextResponse.json(
        { error: `No T212 instrument found for ${ticker}. DB not modified.` },
        { status: 500 },
      );
    }

    // ── Step 2: Cancel existing T212 stop (if any) ──
    let cancelledStopId: number | null = null;
    try {
      const orders = await getPendingOrders(t212Settings);
      const existingStop = orders.find(
        (o) =>
          o.ticker.toUpperCase() === t212Ticker.toUpperCase() &&
          isStopOrderType(o.type),
      );
      if (existingStop) {
        await cancelOrder(t212Settings, existingStop.id);
        cancelledStopId = existingStop.id;
        await sleep(2500); // T212 rate-limit buffer between cancel and next write
      }
    } catch (cancelErr) {
      const msg = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
      log.error({ id, ticker, error: msg }, "Failed to cancel T212 stop before close — aborting");
      return NextResponse.json(
        {
          error: `Failed to cancel T212 stop for ${ticker}: ${msg}. Market sell NOT placed. DB not modified.`,
        },
        { status: 500 },
      );
    }

    // ── Step 3: Place market sell on T212 ──
    let sellOrder: Awaited<ReturnType<typeof placeMarketSellOrder>>;
    try {
      sellOrder = await placeMarketSellOrder(t212Settings, t212Ticker, shares);
    } catch (sellErr) {
      const msg = sellErr instanceof Error ? sellErr.message : String(sellErr);
      log.error(
        { id, ticker, t212Ticker, shares, cancelledStopId, error: msg },
        "T212 market sell failed — DB NOT closed.",
      );

      // CRITICAL alert: stop was cancelled but sell failed → unprotected position
      if (cancelledStopId !== null) {
        try {
          await sendTelegram({
            text:
              `<b>🚨 CRITICAL — CLOSE FAILED, NO STOP</b>\n` +
              `<code>${ticker}</code>\n` +
              `Stop cancelled (id ${cancelledStopId}) but market sell failed.\n` +
              `Position is UNPROTECTED on T212.\n` +
              `Error: ${msg}\n` +
              `<b>SET STOP MANUALLY OR CLOSE IMMEDIATELY</b>`,
            parseMode: "HTML",
          });
        } catch {
          /* best effort */
        }
      }

      return NextResponse.json(
        {
          error: `T212 market sell failed: ${msg}. DB not modified.`,
          stopCancelled: cancelledStopId !== null,
          unprotected: cancelledStopId !== null,
        },
        { status: 500 },
      );
    }

    // ── Step 4: Wait + extract fill price ──
    await sleep(2500);

    const sellOrderRec = sellOrder as unknown as Record<string, unknown>;
    const fillPriceRaw =
      (sellOrderRec["fillPrice"] as number | undefined) ??
      (sellOrderRec["filledValue"] as number | undefined);
    // T212 returns GBX (pence) for .L tickers — normalise to GBP (pounds)
    const fillPriceNormalised =
      typeof fillPriceRaw === "number" && Number.isFinite(fillPriceRaw) && fillPriceRaw > 0 && isT212Pence(t212Ticker, instruments)
        ? fillPriceRaw / 100
        : fillPriceRaw;
    const exitPrice =
      typeof fillPriceNormalised === "number" && Number.isFinite(fillPriceNormalised) && fillPriceNormalised > 0
        ? fillPriceNormalised
        : fallbackExitPrice;

    const riskPerShare = entryPrice - hardStop;
    const rMultiple =
      riskPerShare !== 0 ? (exitPrice - entryPrice) / riskPerShare : 0;

    // ── Step 5: Mark DB closed (only after T212 confirmed) ──
    const updated = await db.trade.update({
      where: { id },
      data: {
        status: "CLOSED",
        exitDate: new Date(),
        exitPrice,
        exitReason: agentReasoning ? `AGENT: ${agentReasoning}` : "AGENT_CLOSE",
        rMultiple,
      },
    } as unknown);

    try {
      const pnl = (exitPrice - entryPrice) * shares;
      await sendTelegram({
        text:
          `🤖 <b>AGENT CLOSED</b> — ${ticker}\n` +
          `T212 sell: ${sellOrder.id} (${shares} shares)\n` +
          `Entry: ${entryPrice.toFixed(2)} → Exit: ${exitPrice.toFixed(2)}\n` +
          `P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}\n` +
          `R: ${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(2)}R\n` +
          (agentReasoning ? `Reason: ${agentReasoning}` : ""),
        parseMode: "HTML",
      });
    } catch {
      /* best effort */
    }

    log.info(
      { id, ticker, t212OrderId: sellOrder.id, exitPrice, shares, agentReasoning },
      "Trade closed by agent (T212 sell confirmed, DB updated)",
    );

    // Mark any undismissed TimeStopFlag as actedOn — tracks whether
    // time-stop flags actually led to exits vs being ignored.
    try {
      const flagResult = await db.timeStopFlag.updateMany({
        where: { tradeId: id, dismissed: false, actedOn: false },
        data: { actedOn: true },
      } as unknown);
      if (flagResult.count > 0) {
        log.info({ tradeId: id, flagsActedOn: flagResult.count }, "TimeStopFlag(s) marked actedOn");
      }
    } catch {
      /* non-fatal — best effort */
    }

    // Fire-and-forget: ask the agent to write a post-mortem journal entry.
    // We do not await — journal writing calls Anthropic and can take seconds.
    try {
      const baseUrl =
        process.env["TRADECORE_BASE_URL"] ?? `http://localhost:${process.env["PORT"] ?? 3000}`;
      const dashToken = process.env["DASHBOARD_TOKEN"] ?? "";
      void fetch(`${baseUrl}/api/agent/journal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(dashToken ? { Authorization: `Bearer ${dashToken}` } : {}),
        },
        body: JSON.stringify({ tradeId: id }),
      }).catch((err: unknown) => {
        log.warn({ id, err }, "Trade journal POST failed (non-fatal)");
      });
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({
      ok: true,
      tradeId: id,
      ticker,
      t212OrderId: sellOrder.id,
      stopCancelled: cancelledStopId,
      exitPrice,
      shares,
      rMultiple: Math.round(rMultiple * 100) / 100,
      status: (updated as Record<string, unknown>)["status"],
    });
  } catch (err) {
    log.error({ err }, "Failed to close trade");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to close trade" },
      { status: 500 },
    );
  }
}
