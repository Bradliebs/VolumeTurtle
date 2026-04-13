import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { updateSettingsSchema, validateBody } from "@/lib/validation";
import { createLogger } from "@/lib/logger";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const log = createLogger("api/settings");

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
    log.error({ err }, "Failed to load settings");
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const rlResponse = rateLimit(getRateLimitKey(request), 10, 60_000);
  if (rlResponse) return rlResponse;

  try {
    const parsed = await validateBody(request, updateSettingsSchema);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { settings, t212 } = parsed.data!;

    // Whitelist of allowed setting keys
    const ALLOWED_KEYS = new Set([
      "riskPctPerTrade", "maxPositions", "maxExposure",
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
      // Write credentials to .env.local and update process.env so they take effect immediately
      if (t212.apiKey) {
        // Sanitize values — prevent newline injection that could overwrite other env vars
        const sanitize = (v: string) => v.replace(/[\r\n]/g, "");

        const fs = await import("fs");
        const path = await import("path");
        const envLocalPath = path.resolve(process.cwd(), ".env.local");

        const lines: string[] = [];
        lines.push(`T212_API_KEY=${sanitize(t212.apiKey)}`);
        if (t212.apiSecret != null) lines.push(`T212_API_SECRET=${sanitize(t212.apiSecret)}`);
        if (t212.environment) lines.push(`T212_ENVIRONMENT=${sanitize(t212.environment)}`);
        if (t212.accountType) lines.push(`T212_ACCOUNT_TYPE=${sanitize(t212.accountType)}`);

        // Read existing .env.local, strip old T212 lines, append new ones
        let existing = "";
        try { existing = fs.readFileSync(envLocalPath, "utf-8"); } catch { /* file doesn't exist yet */ }
        const kept = existing.split("\n").filter((l: string) => !l.startsWith("T212_"));
        const merged = [...kept.filter((l: string) => l.trim() !== ""), ...lines].join("\n") + "\n";
        fs.writeFileSync(envLocalPath, merged, "utf-8");

        // Update process.env in-memory so it takes effect without restart
        process.env["T212_API_KEY"] = t212.apiKey;
        if (t212.apiSecret != null) process.env["T212_API_SECRET"] = t212.apiSecret;
        if (t212.environment) process.env["T212_ENVIRONMENT"] = t212.environment;
        if (t212.accountType) process.env["T212_ACCOUNT_TYPE"] = t212.accountType;

        log.info("T212 credentials saved to .env.local");
      }

      await prisma.t212Connection.upsert({
        where: { id: "default" },
        create: {
          id: "default",
          environment: t212.environment ?? "live",
          apiKey: "ENV:T212_API_KEY",
          accountType: t212.accountType ?? "isa",
          connected: true,
        },
        update: {
          environment: t212.environment,
          accountType: t212.accountType,
          connected: true,
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    log.error({ err }, "Failed to save settings");
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
