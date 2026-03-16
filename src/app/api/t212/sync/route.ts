import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { loadT212Settings, getAccountCash, getPositionsWithStopsMapped } from "@/lib/t212/client";
import type { T212Position } from "@/lib/t212/client";

export async function POST() {
  try {
    const settings = loadT212Settings();
    if (!settings) {
      return NextResponse.json({ error: "T212 not configured — set T212_API_KEY in .env" }, { status: 400 });
    }

    // Fetch T212 data (with stop orders matched to positions)
    const [accountSummary, t212Positions] = await Promise.all([
      getAccountCash(settings),
      getPositionsWithStopsMapped(settings),
    ]);

    const balance = accountSummary.total ?? accountSummary.cash ?? 0;
    const currency = accountSummary.currencyCode ?? "GBP";

    // Fetch VT open trades
    const vtTrades = await prisma.trade.findMany({ where: { status: "OPEN" } });

    // Detect discrepancies
    const discrepancies: Array<{
      type: "IN_T212_NOT_VT" | "IN_VT_NOT_T212";
      ticker: string;
      t212Position?: T212Position;
      vtTrade?: { ticker: string; shares: number; entryPrice: number };
    }> = [];

    // Check T212 positions not in VT
    for (const pos of t212Positions) {
      const vtMatch = vtTrades.find((t) => t.ticker === pos.ticker);
      if (!vtMatch) {
        discrepancies.push({
          type: "IN_T212_NOT_VT",
          ticker: pos.ticker,
          t212Position: pos,
        });
      }
    }

    // Check VT trades not in T212
    for (const trade of vtTrades) {
      const t212Match = t212Positions.find((p) => p.ticker === trade.ticker);
      if (!t212Match) {
        discrepancies.push({
          type: "IN_VT_NOT_T212",
          ticker: trade.ticker,
          vtTrade: { ticker: trade.ticker, shares: trade.shares, entryPrice: trade.entryPrice },
        });
      }
    }

    // Update account snapshot with real balance
    await prisma.accountSnapshot.create({
      data: {
        date: new Date(),
        balance,
        openTrades: vtTrades.length,
      },
    });

    // Update T212Connection record
    await prisma.t212Connection.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        environment: settings.environment,
        apiKey: "ENV:T212_API_KEY",
        accountType: settings.accountType,
        connected: true,
        lastSyncAt: new Date(),
        lastSyncStatus: "success",
      },
      update: {
        connected: true,
        lastSyncAt: new Date(),
        lastSyncStatus: "success",
        lastSyncError: null,
      },
    });

    return NextResponse.json({
      balance,
      currency,
      t212Positions,
      volumeTurtleTrades: vtTrades.map((t) => ({
        id: t.id,
        ticker: t.ticker,
        shares: t.shares,
        entryPrice: t.entryPrice,
        status: t.status,
      })),
      discrepancies,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Update T212Connection with error
    try {
      await prisma.t212Connection.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          environment: "demo",
          apiKey: "ENV:T212_API_KEY",
          accountType: "isa",
          connected: false,
          lastSyncAt: new Date(),
          lastSyncStatus: "error",
          lastSyncError: err instanceof Error ? err.message : "Sync failed",
        },
        update: {
          lastSyncAt: new Date(),
          lastSyncStatus: "error",
          lastSyncError: err instanceof Error ? err.message : "Sync failed",
        },
      });
    } catch {
      // silent
    }

    console.error("[POST /api/t212/sync] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "T212 sync failed" },
      { status: 500 },
    );
  }
}
