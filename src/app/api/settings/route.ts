import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { updateSettingsSchema, validateBody } from "@/lib/validation";

export async function GET() {
  try {
    const [settings, t212] = await Promise.all([
      prisma.settings.findMany(),
      prisma.t212Connection.findFirst(),
    ]);

    const settingsMap: Record<string, string> = {};
    for (const s of settings) {
      settingsMap[s.key] = s.value;
    }

    // System info
    const { getUniverse } = await import("@/lib/universe/tickers");
    const universe = getUniverse();
    const [lastScan, signalCount, tradeCount] = await Promise.all([
      prisma.scanResult.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true, ticker: true } }),
      prisma.scanResult.count({ where: { signalFired: true, scanDate: { gte: new Date(Date.now() - 86400000) } } }),
      prisma.trade.count(),
    ]);

    return NextResponse.json({
      settings: settingsMap,
      t212: t212
        ? {
            environment: t212.environment,
            accountType: t212.accountType,
            connected: t212.connected,
            lastSyncAt: t212.lastSyncAt?.toISOString() ?? null,
            lastSyncStatus: t212.lastSyncStatus,
            lastSyncError: t212.lastSyncError,
          }
        : null,
      system: {
        universeSize: universe.length,
        lastScan: lastScan?.createdAt?.toISOString() ?? null,
        signalCount,
        tradeCount,
      },
      // Indicate if T212 env vars are set (without exposing values)
      t212Configured: !!process.env["T212_API_KEY"],
    });
  } catch (err) {
    console.error("[GET /api/settings] Error:", err);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = await validateBody(request, updateSettingsSchema);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { settings, t212 } = parsed.data;

    // Whitelist of allowed setting keys
    const ALLOWED_KEYS = new Set([
      "riskPctPerTrade", "maxPositions", "maxExposurePct",
      "balanceSource", "manualBalance",
      "last_backup_at", "theme", "notifications",
    ]);

    // Save key-value settings
    if (settings && typeof settings === "object") {
      for (const [key, value] of Object.entries(settings)) {
        if (!ALLOWED_KEYS.has(key)) {
          return NextResponse.json({ error: `Invalid setting key: ${key}` }, { status: 400 });
        }
        if (typeof key === "string" && typeof value === "string") {
          await prisma.settings.upsert({
            where: { key },
            create: { key, value },
            update: { value },
          });
        }
      }
    }

    // Save T212 connection settings
    if (t212) {
      await prisma.t212Connection.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          environment: t212.environment ?? "demo",
          apiKey: "ENV:T212_API_KEY",
          accountType: t212.accountType ?? "isa",
        },
        update: {
          environment: t212.environment,
          accountType: t212.accountType,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[PUT /api/settings] Error:", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
