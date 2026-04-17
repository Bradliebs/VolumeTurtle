import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/db/client";
import { scoreTimingGate } from "@/lib/timing-scorer";
import { loadT212Settings, buyWithStop } from "@/lib/t212/client";
import { validateBody } from "@/lib/validation";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/t212/buy");

const ORPHAN_LOG_PATH = path.join(process.cwd(), "logs", "orphaned-t212-orders.jsonl");

/**
 * Append a record of a T212 order whose DB persistence failed.
 * This file is the source of truth for manual reconciliation when the broker
 * accepted an order but the DB write failed (network, transaction, crash).
 * Best-effort: if even this write fails, the structured log is the fallback.
 */
async function recordOrphanedOrder(record: Record<string, unknown>): Promise<void> {
  try {
    await fs.mkdir(path.dirname(ORPHAN_LOG_PATH), { recursive: true });
    await fs.appendFile(ORPHAN_LOG_PATH, JSON.stringify(record) + "\n", "utf8");
  } catch (writeErr) {
    log.error({ writeErr, record }, "[CRITICAL] Failed to write orphaned-t212-orders.jsonl");
  }
}

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
  close: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  volume: z.number().optional(),
  avgVolume20: z.number().optional(),
  atr14: z.number().optional(),
});

const db = prisma as unknown as {
  trade: {
    findFirst: (args: { where: { ticker: string; status: string } }) => Promise<{ id: string } | null>;
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  };
  stopHistory: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
};

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
      close, high, low, volume, avgVolume20, atr14,
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
      console.info("[FTA] bypass broker gate", { ticker, reason: "timing_fields_missing" });
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
      console.warn("[FTA] block broker gate", {
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
      console.info("[FTA] pass broker gate", {
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
        "[FTA] Applied broker timing multiplier before T212 call",
      );
    }

    log.info({ ticker, shares: adjustedShares, suggestedEntry, hardStop }, "Placing market buy order on T212");

    // Place market buy + stop on T212
    const { marketOrder, stopOrder } = await buyWithStop(
      settings,
      ticker,
      adjustedShares,
      hardStop,
    );

    log.info(
      { ticker, marketOrderId: marketOrder.id, stopOrderId: stopOrder.id },
      "T212 market buy + stop placed successfully",
    );

    // Persist Trade + initial StopHistory atomically. If this fails AFTER the
    // broker has accepted the order, we have a real T212 position with no DB
    // record — the orphan log makes that visible for manual reconciliation.
    let trade: { id: string };
    try {
      trade = await db.$transaction(async (tx) => {
        const txDb = tx as {
          trade: { create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }> };
          stopHistory: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> };
        };
        const created = await txDb.trade.create({
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
            signalSource: signalSource ?? "volume",
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
        await txDb.stopHistory.create({
          data: {
            tradeId: created.id,
            date: new Date(),
            stopLevel: hardStop,
            stopType: "HARD",
            changed: false,
            changeAmount: null,
            note: `Bought via T212 BUY NOW — market order placed`,
          },
        });
        return created;
      });
    } catch (dbErr) {
      const orphan = {
        timestamp: new Date().toISOString(),
        ticker,
        shares: adjustedShares,
        suggestedEntry,
        hardStop,
        marketOrderId: marketOrder.id,
        stopOrderId: stopOrder.id,
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      };
      log.error(
        { err: dbErr, ...orphan },
        "[CRITICAL] T212 order accepted but DB persistence failed — orphaned position",
      );
      await recordOrphanedOrder(orphan);
      return NextResponse.json(
        {
          error: "ORPHANED_T212_ORDER",
          message:
            "T212 accepted the buy + stop but the database write failed. " +
            "This position is NOT tracked. Manually reconcile using the broker order IDs below " +
            `or check ${path.relative(process.cwd(), ORPHAN_LOG_PATH)}.`,
          marketOrderId: marketOrder.id,
          stopOrderId: stopOrder.id,
          ticker,
          shares: adjustedShares,
        },
        { status: 500 },
      );
    }

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
