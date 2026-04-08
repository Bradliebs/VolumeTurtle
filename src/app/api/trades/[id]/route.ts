import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { closeTradeSchema, validateBody } from "@/lib/validation";
import { createLogger } from "@/lib/logger";
import { sendTelegram } from "@/lib/telegram";

const log = createLogger("api/trades/:id");

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsed = await validateBody(request, closeTradeSchema);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { exitPrice } = parsed.data!;

    const trade = await prisma.trade.findUnique({ where: { id } });
    if (!trade) {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }
    if (trade.status === "CLOSED") {
      return NextResponse.json({ error: "Trade is already closed" }, { status: 400 });
    }

    const riskPerShare = trade.entryPrice - trade.hardStop;
    const rMultiple =
      riskPerShare !== 0
        ? (exitPrice - trade.entryPrice) / riskPerShare
        : 0;

    // Runner exit metrics
    const runnerData: Record<string, unknown> = {};
    if (trade.isRunner) {
      const exitProfitPct = (exitPrice - trade.entryPrice) / trade.entryPrice;
      const captureRate = trade.runnerPeakProfit
        ? exitProfitPct / trade.runnerPeakProfit
        : null;
      runnerData.runnerExitProfit = exitProfitPct;
      runnerData.runnerCaptureRate = captureRate;

      const holdDays = Math.floor(
        (Date.now() - new Date(trade.entryDate).getTime()) / (1000 * 60 * 60 * 24),
      );
      try {
        await sendTelegram({
          text:
            `🏁 <b>RUNNER CLOSED — ${trade.ticker}</b>\n` +
            `Entry: $${trade.entryPrice.toFixed(2)} → Exit: $${exitPrice.toFixed(2)}\n` +
            `Profit: ${exitProfitPct >= 0 ? "+" : ""}${(exitProfitPct * 100).toFixed(1)}%\n` +
            `Peak was: +${((trade.runnerPeakProfit ?? 0) * 100).toFixed(1)}%\n` +
            `Captured: ${captureRate != null ? (captureRate * 100).toFixed(0) : "—"}% of peak move\n` +
            `Hold time: ${holdDays} days`,
          parseMode: "HTML",
        });
      } catch { /* best effort */ }
    }

    const updated = await prisma.trade.update({
      where: { id },
      data: {
        status: "CLOSED",
        exitDate: new Date(),
        exitPrice,
        exitReason: "MANUAL",
        rMultiple,
        ...runnerData,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    log.error({ err }, "Failed to update trade");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update trade" },
      { status: 500 },
    );
  }
}
