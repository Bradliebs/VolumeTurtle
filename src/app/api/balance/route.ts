import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { balance } = body;

    if (balance == null || typeof balance !== "number" || balance <= 0) {
      return NextResponse.json(
        { error: "balance is required and must be a positive number" },
        { status: 400 },
      );
    }

    const latest = await prisma.accountSnapshot.findFirst({
      orderBy: { date: "desc" },
    });

    const snapshot = await prisma.accountSnapshot.create({
      data: {
        date: new Date(),
        balance,
        openTrades: latest?.openTrades ?? 0,
      },
    });

    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("[PATCH /api/balance] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update balance" },
      { status: 500 },
    );
  }
}
