import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { scoreTimingGate } from "@/lib/timing-scorer";
import { createTradeSchema, validateBody } from "@/lib/validation";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/trades");

const db = prisma as unknown as {
  trade: {
    findFirst: (args: { where: { ticker: string; status: string } }) => Promise<{ id: string } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
};

export async function POST(request: NextRequest) {
  try {
    // Rate limit: max 10 trade creations per minute
    const limited = rateLimit(getRateLimitKey(request), 10, 60_000);
    if (limited) return limited;

    const parsed = await validateBody(request, createTradeSchema);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const {
      ticker,
      suggestedEntry,
      hardStop,
      shares,
      close,
      high,
      low,
      volume,
      avgVolume20,
      atr14,
      volumeRatio,
      rangePosition,
      atr20,
      signalSource,
      signalScore,
      signalGrade,
    } = parsed.data!;

    // Prevent duplicate open trades for the same ticker
    const existingOpen = await db.trade.findFirst({
      where: { ticker, status: "OPEN" },
    });
    if (existingOpen) {
      return NextResponse.json(
        { error: `An open trade already exists for ${ticker}` },
        { status: 409 },
      );
    }

    const hasAllTimingFields = close != null
      && high != null
      && low != null
      && volume != null
      && avgVolume20 != null
      && atr14 != null;

    if (!hasAllTimingFields) {
      console.info("[FTA] bypass non-broker gate", { ticker, reason: "timing_fields_missing" });
    }

    const timingResult = hasAllTimingFields
      ? scoreTimingGate({
          close,
          high,
          low,
          volume,
          avgVolume20,
          atr14,
          entryDate: new Date(),
        })
      : null;

    if (timingResult && !timingResult.timingGatePass) {
      console.warn("[FTA] block non-broker gate", {
        ticker,
        timingScore: timingResult.timingScore,
        flowFlag: timingResult.flowFlag,
        flowType: timingResult.flowType,
      });
      return NextResponse.json(
        {
          error: "TIMING_GATE_BLOCKED",
          message: `Trade blocked: timingScore ${timingResult.timingScore}/100 (minimum 70 required)`,
          timingScore: timingResult.timingScore,
          timingResult,
        },
        { status: 422 },
      );
    }

    let adjustedShares = shares;
    if (timingResult) {
      console.info("[FTA] pass non-broker gate", {
        ticker,
        timingScore: timingResult.timingScore,
        flowFlag: timingResult.flowFlag,
        flowType: timingResult.flowType,
      });
      adjustedShares = Math.round((shares * timingResult.positionSizeMultiplier) * 10_000) / 10_000;
      log.info(
        {
          ticker,
          baseShares: shares,
          adjustedShares,
          multiplier: timingResult.positionSizeMultiplier,
          timingScore: timingResult.timingScore,
          flowType: timingResult.flowType,
        },
        "Applied timing gate position size multiplier",
      );
    }

    const trade = await db.trade.create({
      data: {
        ticker,
        entryDate: new Date(),
        entryPrice: suggestedEntry,
        shares: adjustedShares,
        hardStop,
        trailingStop: hardStop,
        status: "OPEN",
        volumeRatio: volumeRatio ?? 0,
        rangePosition: rangePosition ?? 0,
        atr20: atr20 ?? 0,
        signalSource: signalSource ?? "manual",
        signalScore: signalScore ?? null,
        signalGrade: signalGrade ?? null,
        timingScore: timingResult?.timingScore ?? null,
        closeStrength: timingResult?.closeStrength ?? null,
        volumeExpansion: timingResult?.volumeExpansion ?? null,
        rangeStability: timingResult?.rangeStability ?? null,
        flowFlag: timingResult?.flowFlag ?? null,
        flowType: timingResult?.flowType ?? null,
        timingGatePass: timingResult?.timingGatePass ?? null,
        positionSizeMultiplier: timingResult?.positionSizeMultiplier ?? null,
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
