import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { exitPrice } = body;

    if (exitPrice == null || typeof exitPrice !== "number") {
      return NextResponse.json(
        { error: "exitPrice is required and must be a number" },
        { status: 400 },
      );
    }

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
    console.error("[PATCH /api/trades/:id] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update trade" },
      { status: 500 },
    );
  }
}
