import "dotenv/config";
import { randomUUID } from "crypto";
import { gatherContext } from "./context";
import { runAgentCycle, DEFAULT_MODEL } from "./executor";
import { logCycle } from "./logger";
import { buildSundaySystemPrompt } from "./prompt";
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
    console.error("[AgentSunday] Failed to send Telegram alert.");
  }
}

async function main(): Promise<void> {
  const runStart = Date.now();
  const cycleId = randomUUID();
  const cycleStartedAt = new Date();

  console.log(`[AgentSunday] Maintenance cycle started — ${cycleId} at ${cycleStartedAt.toISOString()}`);

  // ── 1. Check AiSettings ────────────────────────────────────────
  const aiSettings = await db.aiSettings.findFirst();
  const agentEnabled = (aiSettings?.["enabled"] as boolean | undefined) ?? config.AGENT_ENABLED;

  if (!agentEnabled) {
    console.log("[AgentSunday] Agent disabled. Exiting.");
    process.exit(0);
  }

  const apiKey = (aiSettings?.["anthropicApiKey"] as string | undefined) ?? config.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[AgentSunday] No ANTHROPIC_API_KEY configured.");
    process.exit(1);
  }

  process.env["ANTHROPIC_API_KEY"] = apiKey;

  const activeModel = (aiSettings?.["model"] as string | undefined) ?? DEFAULT_MODEL;
  console.log(`[AgentSunday] Model: ${activeModel}`);

  // ── 2. Gather context (for reference in the cycle) ─────────────
  console.log("[AgentSunday] Gathering context...");
  let context;
  try {
    context = await gatherContext(cycleId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[AgentSunday] Context error:", message);
    await sendTelegramSafe(`🔴 Sunday maintenance context error: ${message}`);
    process.exit(1);
  }

  // No halt check — Sunday maintenance always runs

  // ── 3. Run Claude with Sunday prompt ───────────────────────────
  console.log("[AgentSunday] Running Sunday maintenance cycle...");
  let result;
  try {
    result = await runAgentCycle(context, BASE_URL, buildSundaySystemPrompt(), activeModel);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[AgentSunday] Claude error:", message);
    await sendTelegramSafe(`🔴 Sunday maintenance error: ${message}`);
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
    `[AgentSunday] Cycle complete in ${duration}s | ${result.actions.length} tool calls | Telegram: ${result.telegramSent ? "sent" : "NOT SENT"}`
  );

  if (!result.telegramSent) {
    await sendTelegramSafe(
      `⚠️ Sunday maintenance completed but Telegram summary was not sent.\nCycle: ${cycleId}`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[AgentSunday] Unhandled error:", err);
  process.exit(1);
});
