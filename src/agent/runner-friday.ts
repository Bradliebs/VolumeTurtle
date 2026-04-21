import "dotenv/config";
import { randomUUID } from "crypto";
import { gatherContext } from "./context";
import { runAgentCycle, DEFAULT_MODEL } from "./executor";
import { logCycle } from "./logger";
import { buildFridaySystemPrompt } from "./prompt";
import { prisma } from "@/db/client";
import { config } from "@/lib/config";

const db = prisma as unknown as {
  aiSettings: { findFirst: () => Promise<Record<string, unknown> | null> };
};

const BASE_URL = config.TRADECORE_BASE_URL;

async function sendTelegramSafe(message: string): Promise<void> {
  try {
    const token = process.env["DASHBOARD_TOKEN"] ?? "";
    await fetch(`${BASE_URL}/api/telegram/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ message }),
    });
  } catch {
    console.error("[AgentFriday] Failed to send Telegram alert.");
  }
}

async function main(): Promise<void> {
  const runStart = Date.now();
  const cycleId = randomUUID();
  const cycleStartedAt = new Date();

  console.log(`[AgentFriday] Weekly debrief started — ${cycleId} at ${cycleStartedAt.toISOString()}`);

  // ── 1. Check AiSettings ────────────────────────────────────────
  const aiSettings = await db.aiSettings.findFirst();
  const agentEnabled = (aiSettings?.["enabled"] as boolean | undefined) ?? config.AGENT_ENABLED;

  if (!agentEnabled) {
    console.log("[AgentFriday] Agent disabled. Exiting.");
    process.exit(0);
  }

  const apiKey = (aiSettings?.["anthropicApiKey"] as string | undefined) ?? config.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[AgentFriday] No ANTHROPIC_API_KEY configured.");
    process.exit(1);
  }

  process.env["ANTHROPIC_API_KEY"] = apiKey;

  const activeModel = (aiSettings?.["model"] as string | undefined) ?? DEFAULT_MODEL;
  console.log(`[AgentFriday] Model: ${activeModel}`);

  // ── 2. Gather context (for reference) ──────────────────────────
  console.log("[AgentFriday] Gathering context...");
  let context;
  try {
    context = await gatherContext(cycleId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[AgentFriday] Context error:", message);
    await sendTelegramSafe(`🔴 Friday debrief context error: ${message}`);
    process.exit(1);
  }

  // No halt check — Friday debrief always runs

  // ── 3. Run Claude with Friday prompt ───────────────────────────
  console.log("[AgentFriday] Running weekly debrief...");
  let result;
  try {
    result = await runAgentCycle(context, BASE_URL, buildFridaySystemPrompt(), activeModel);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[AgentFriday] Claude error:", message);
    await sendTelegramSafe(`🔴 Friday debrief error: ${message}`);
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

  // ── 4. Log the decision ────────────────────────────────────────
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
    `[AgentFriday] Debrief complete in ${duration}s | ${result.actions.length} tool calls | Telegram: ${result.telegramSent ? "sent" : "NOT SENT"}`
  );

  if (!result.telegramSent) {
    await sendTelegramSafe(
      `⚠️ Friday debrief completed but Telegram summary was not sent.\nCycle: ${cycleId}`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[AgentFriday] Unhandled error:", err);
  process.exit(1);
});
