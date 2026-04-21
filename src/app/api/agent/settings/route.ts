import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const db = prisma as unknown as {
  aiSettings: {
    findFirst: () => Promise<Record<string, unknown> | null>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
  };
  agentHaltFlag: {
    findFirst: () => Promise<Record<string, unknown> | null>;
    upsert: (args: unknown) => Promise<Record<string, unknown>>;
  };
  agentDecisionLog: {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
};

/**
 * GET /api/agent/settings — fetch agent state for the settings UI
 */
export async function GET(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const aiSettings = await db.aiSettings.findFirst();
  const haltFlag = await db.agentHaltFlag.findFirst();
  const lastCycle = await db.agentDecisionLog.findFirst({
    orderBy: { createdAt: "desc" },
  } as unknown);

  return NextResponse.json({
    enabled: (aiSettings?.["enabled"] as boolean) ?? false,
    model: (aiSettings?.["model"] as string) ?? "claude-sonnet-4-20250514",
    halted: (haltFlag?.["halted"] as boolean) ?? false,
    haltReason: (haltFlag?.["reason"] as string) ?? null,
    executionPaused: (haltFlag?.["executionPaused"] as boolean) ?? false,
    lastCycleAt: lastCycle ? (lastCycle["createdAt"] as Date).toISOString() : null,
    lastCycleDurationMs: (lastCycle?.["durationMs"] as number) ?? null,
    lastCycleTelegramSent: (lastCycle?.["telegramSent"] as boolean) ?? null,
    lastCycleToolCalls: lastCycle?.["actionsJson"]
      ? (JSON.parse(lastCycle["actionsJson"] as string) as unknown[]).length
      : null,
  });
}

/**
 * PATCH /api/agent/settings — update agent settings
 */
export async function PATCH(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 10, 60_000);
  if (limited) return limited;

  try {
    const body = (await req.json()) as Record<string, unknown>;

    // Toggle agent enabled
    if (typeof body["enabled"] === "boolean") {
      await db.aiSettings.update({
        where: { id: 1 },
        data: { enabled: body["enabled"] },
      } as unknown);
    }

    // Update model selection
    const ALLOWED_MODELS = [
      "claude-sonnet-4-20250514",
      "claude-haiku-4-5-20251001",
    ];
    if (typeof body["model"] === "string" && ALLOWED_MODELS.includes(body["model"])) {
      await db.aiSettings.update({
        where: { id: 1 },
        data: { model: body["model"] },
      } as unknown);
    }

    // Toggle halt flag
    if (typeof body["halted"] === "boolean") {
      const reason = typeof body["reason"] === "string" ? body["reason"] : null;
      await db.agentHaltFlag.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          halted: body["halted"],
          reason: body["halted"] ? (reason ?? "Manual halt from settings UI") : null,
          setAt: new Date(),
          setBy: "SETTINGS_UI",
        },
        update: {
          halted: body["halted"],
          reason: body["halted"] ? (reason ?? "Manual halt from settings UI") : null,
          setAt: new Date(),
          setBy: "SETTINGS_UI",
        },
      } as unknown);
    }

    // Toggle executionPaused flag (independent of halt — stops still ratchet)
    if (typeof body["executionPaused"] === "boolean") {
      await db.agentHaltFlag.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          halted: false,
          executionPaused: body["executionPaused"],
          reason: null,
          setAt: new Date(),
          setBy: "SETTINGS_UI",
        },
        update: {
          executionPaused: body["executionPaused"],
          setAt: new Date(),
          setBy: "SETTINGS_UI",
        },
      } as unknown);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
