import "dotenv/config";
import { randomUUID } from "crypto";
import { gatherContext } from "./context";
import { runAgentCycle, DEFAULT_MODEL } from "./executor";
import { logCycle } from "./logger";
import { clearFailureCount, incrementFailureCount } from "./failureTracker";

import { buildSystemPrompt } from "./prompt";
import { prisma } from "@/db/client";
import { config } from "@/lib/config";

const db = prisma as unknown as {
  aiSettings: { findFirst: () => Promise<Record<string, unknown> | null> };
};

const BASE_URL = config.TRADECORE_BASE_URL;

async function sendTelegramSafe(message: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const token = process.env["DASHBOARD_TOKEN"] ?? "";
    await fetch(`${BASE_URL}/api/telegram/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });
  } catch {
    console.error("[Agent] Failed to send Telegram alert.");
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const runStart = Date.now();
  const cycleId = randomUUID();
  const cycleStartedAt = new Date();

  console.log(`[Agent] Cycle started — ${cycleId} at ${cycleStartedAt.toISOString()}`);

  // ── 1. Check AiSettings ────────────────────────────────────────
  const aiSettings = await db.aiSettings.findFirst();
  const agentEnabled = (aiSettings?.["enabled"] as boolean | undefined) ?? config.AGENT_ENABLED;

  if (!agentEnabled) {
    console.log("[Agent] Agent disabled. Exiting.");
    process.exit(0);
  }

  const apiKey = (aiSettings?.["anthropicApiKey"] as string | undefined) ?? config.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[Agent] No ANTHROPIC_API_KEY configured.");
    process.exit(1);
  }

  process.env["ANTHROPIC_API_KEY"] = apiKey;

  const activeModel = (aiSettings?.["model"] as string | undefined) ?? DEFAULT_MODEL;
  console.log(`[Agent] Model: ${activeModel}`);

  // ── 2. Gather context ──────────────────────────────────────────
  console.log("[Agent] Gathering context...");
  let context;
  try {
    context = await gatherContext(cycleId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Agent] Context error:", message);
    await sendTelegramSafe(`🔴 Agent context error: ${message}`);
    process.exit(1);
  }

  // ── 3. Short-circuit if halted ─────────────────────────────────
  if (context.haltFlag.halted) {
    console.log(`[Agent] HALTED — ${context.haltFlag.reason}. Exiting.`);
    await sendTelegramSafe(
      `🛑 Agent cycle skipped — HALT flag active\nReason: ${context.haltFlag.reason ?? "Unknown"}\n\nSend RESUME to clear.`
    );
    process.exit(0);
  }

  // ── 4. Run Claude agentic loop ─────────────────────────────────
  console.log("[Agent] Running Claude cycle...");
  let result;
  try {
    result = await runAgentCycle(context, BASE_URL, undefined, activeModel);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failureCount = incrementFailureCount();
    console.error(`[Agent] Claude error (consecutive failures: ${failureCount}):`, message);
    await sendTelegramSafe(`🔴 Agent Claude error (#${failureCount}): ${message}`);
    await logCycle({
      cycleId,
      cycleStartedAt,
      context,
      reasoning: "",
      actions: [],
      telegramSent: false,
      totalDurationMs: Date.now() - runStart,
      errorMessage: message,
    });
    process.exit(1);
  }

  // Cycle succeeded — reset the failure counter and remove the file.
  clearFailureCount();

  // ── 5. (Shadow engine removed — was producing false divergences) ──

  // ── 6. Log the decision ────────────────────────────────────────
  await logCycle({
    cycleId,
    cycleStartedAt,
    context,
    reasoning: result.reasoning,
    actions: result.actions,
    telegramSent: result.telegramSent,
    totalDurationMs: Date.now() - runStart,
    errorMessage: result.error,
  });

  const duration = ((Date.now() - runStart) / 1000).toFixed(1);
  console.log(
    `[Agent] Cycle complete in ${duration}s | ${result.actions.length} tool calls | Telegram: ${result.telegramSent ? "sent" : "NOT SENT"}`
  );

  if (!result.telegramSent) {
    await sendTelegramSafe(
      `⚠️ Agent cycle completed but Telegram summary was not sent.\nCycle: ${cycleId}`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[Agent] Unhandled error:", err);
  process.exit(1);
});
