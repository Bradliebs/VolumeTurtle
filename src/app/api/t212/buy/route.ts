import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/db/client";
import { loadT212Settings, buyWithStop } from "@/lib/t212/client";
import { validateBody } from "@/lib/validation";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/t212/buy");

const buySchema = z.object({
  ticker: z.string().min(1, "Ticker is required"),
  shares: z.number().positive("shares must be positive"),
  suggestedEntry: z.number().positive("suggestedEntry must be positive"),
  hardStop: z.number().positive("hardStop must be positive"),
  riskPerShare: z.number().positive("riskPerShare must be positive"),
  volumeRatio: z.number().min(0),
  rangePosition: z.number().min(0).max(1),
  atr20: z.number().positive("atr20 must be positive"),
  signalSource: z.string().optional(),
  signalScore: z.number().optional(),
  signalGrade: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Strict rate limit: max 3 buys per minute
    const limited = rateLimit(getRateLimitKey(req), 3, 60_000);
    if (limited) return limited;

    const settings = loadT212Settings();
    if (!settings) {
      return NextResponse.json(
        { error: "Trading 212 is not configured" },
        { status: 400 },
      );
    }

    const parsed = await validateBody(req, buySchema);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const {
      ticker, shares, suggestedEntry, hardStop, riskPerShare,
      volumeRatio, rangePosition, atr20, signalSource, signalScore, signalGrade,
    } = parsed.data!;

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

    log.info({ ticker, shares, suggestedEntry, hardStop }, "Placing market buy order on T212");

    // Place market buy + stop on T212
    const { marketOrder, stopOrder } = await buyWithStop(
      settings,
      ticker,
      shares,
      hardStop,
    );

    log.info(
      { ticker, marketOrderId: marketOrder.id, stopOrderId: stopOrder.id },
      "T212 market buy + stop placed successfully",
    );

    // Record trade in database
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
        signalSource: signalSource ?? "volume",
        signalScore: signalScore ?? null,
        signalGrade: signalGrade ?? null,
      },
    });

    // Write initial stop history record
    await prisma.stopHistory.create({
      data: {
        tradeId: trade.id,
        date: new Date(),
        stopLevel: hardStop,
        stopType: "HARD",
        changed: false,
        changeAmount: null,
        note: `Bought via T212 BUY NOW — market order placed`,
      },
    });

    return NextResponse.json({
      success: true,
      trade,
      t212: {
        marketOrderId: marketOrder.id,
        stopOrderId: stopOrder.id,
      },
    }, { status: 201 });
  } catch (err) {
    log.error({ err }, "Failed to execute T212 buy");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to place buy order" },
      { status: 500 },
    );
  }
}
