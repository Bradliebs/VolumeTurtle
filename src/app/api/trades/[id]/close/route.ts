import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { createLogger } from "@/lib/logger";
import { sendTelegram } from "@/lib/telegram";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const log = createLogger("api/trades/:id/close");

const db = prisma as unknown as {
  trade: {
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
  };
};

/**
 * POST /api/trades/[id]/close
 * Closes an open trade. Used by the autonomous agent.
 * Accepts { agentReasoning?: string }.
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

    const entryPrice = trade["entryPrice"] as number;
    const hardStop = trade["hardStop"] as number;
    const currentStop = trade["currentStop"] as number;
    const ticker = trade["ticker"] as string;

    // Use current stop as exit price (agent-triggered close = stop-level exit)
    const exitPrice = currentStop;
    const riskPerShare = entryPrice - hardStop;
    const rMultiple =
      riskPerShare !== 0
        ? (exitPrice - entryPrice) / riskPerShare
        : 0;

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
      const pnl = exitPrice - entryPrice;
      await sendTelegram({
        text:
          `🤖 <b>AGENT CLOSED</b> — ${ticker}\n` +
          `Entry: ${entryPrice.toFixed(2)} → Exit: ${exitPrice.toFixed(2)}\n` +
          `P&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}\n` +
          `R: ${rMultiple >= 0 ? "+" : ""}${rMultiple.toFixed(2)}R\n` +
          (agentReasoning ? `Reason: ${agentReasoning}` : ""),
        parseMode: "HTML",
      });
    } catch {
      /* best effort */
    }

    log.info({ id, ticker, exitPrice, agentReasoning }, "Trade closed by agent");

    return NextResponse.json({
      ok: true,
      tradeId: id,
      ticker,
      exitPrice,
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
