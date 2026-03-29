import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { createTradeSchema, validateBody } from "@/lib/validation";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/trades");

export async function POST(request: NextRequest) {
  try {
    // Rate limit: max 10 trade creations per minute
    const limited = rateLimit(getRateLimitKey(request), 10, 60_000);
    if (limited) return limited;

    const parsed = await validateBody(request, createTradeSchema);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { ticker, suggestedEntry, hardStop, shares, volumeRatio, rangePosition, atr20, signalSource, signalScore, signalGrade } = parsed.data!;

    // Prevent duplicate open trades for the same ticker
    const existingOpen = await prisma.trade.findFirst({
      where: { ticker, status: "OPEN" },
    });
    if (existingOpen) {
      return NextResponse.json(
        { error: `An open trade already exists for ${ticker}` },
        { status: 409 },
      );
    }

    const trade = await prisma.trade.create({
      data: {
        ticker,
        entryDate: new Date(),
        entryPrice: suggestedEntry,
        shares,
        hardStop,
        trailingStop: hardStop,
        status: "OPEN",
        volumeRatio: volumeRatio ?? 0,
        rangePosition: rangePosition ?? 0,
        atr20: atr20 ?? 0,
        signalSource: signalSource ?? "manual",
        signalScore: signalScore ?? null,
        signalGrade: signalGrade ?? null,
      },
    });

    return NextResponse.json(trade, { status: 201 });
  } catch (err) {
    log.error({ err }, "Failed to create trade");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create trade" },
      { status: 500 },
    );
  }
}
