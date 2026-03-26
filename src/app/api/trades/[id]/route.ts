import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { closeTradeSchema, validateBody } from "@/lib/validation";
import { createLogger } from "@/lib/logger";

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

    const updated = await prisma.trade.update({
      where: { id },
      data: {
        status: "CLOSED",
        exitDate: new Date(),
        exitPrice,
        exitReason: "MANUAL",
        rMultiple,
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
