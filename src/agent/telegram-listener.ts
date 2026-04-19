import "dotenv/config";
import fs from "fs";
import path from "path";
import { prisma } from "@/db/client";
import { gatherContext } from "./context";

const db = prisma as unknown as {
  agentHaltFlag: { upsert: (args: unknown) => Promise<unknown> };
  appSettings: { update: (args: unknown) => Promise<unknown> };
  telegramSettings: { findFirst: () => Promise<Record<string, unknown> | null> };
};

const OFFSET_DIR = path.join(
  process.env["USERPROFILE"] ?? "C:\\Users\\Default",
  "VolumeTurtle"
);
const OFFSET_FILE = path.join(OFFSET_DIR, "telegram-offset.txt");

function getOffset(): number {
  try {
    return parseInt(fs.readFileSync(OFFSET_FILE, "utf8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function saveOffset(offset: number): void {
  try {
    fs.mkdirSync(OFFSET_DIR, { recursive: true });
    fs.writeFileSync(OFFSET_FILE, String(offset), "utf8");
  } catch {
    // non-fatal
  }
}

async function getUpdates(botToken: string, offset: number): Promise<unknown[]> {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates?offset=${offset}&timeout=5&allowed_updates=["message"]`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { ok: boolean; result: unknown[] };
  return data.ok ? data.result : [];
}

async function processCommand(text: string, _baseUrl: string): Promise<string> {
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0]?.toUpperCase() ?? "";
  const arg = parts.slice(1).join(" ");

  switch (cmd) {
    case "HALT": {
      const reason = arg || "Manual halt via Telegram";
      await db.agentHaltFlag.upsert({
        where: { id: 1 },
        create: { id: 1, halted: true, reason, setAt: new Date(), setBy: "USER" },
        update: { halted: true, reason, setAt: new Date(), setBy: "USER" },
      } as unknown);
      return `🛑 Agent HALTED\nReason: ${reason}\n\nSend RESUME to clear.`;
    }

    case "RESUME": {
      await db.agentHaltFlag.upsert({
        where: { id: 1 },
        create: { id: 1, halted: false, reason: null, setAt: new Date(), setBy: "USER" },
        update: { halted: false, reason: null, setAt: new Date(), setBy: "USER" },
      } as unknown);
      return `✅ Agent RESUMED\nExecution will continue on the next cycle.`;
    }

    case "PAUSE": {
      await db.appSettings.update({
        where: { id: 1 },
        data: { autoExecutionEnabled: false },
      } as unknown);
      await db.agentHaltFlag.upsert({
        where: { id: 1 },
        create: { id: 1, halted: true, reason: "PAUSED via Telegram", setAt: new Date(), setBy: "USER" },
        update: { halted: true, reason: "PAUSED via Telegram", setAt: new Date(), setBy: "USER" },
      } as unknown);
      return `⏸ Auto-execution PAUSED\nAgent will ratchet stops but not enter new positions.\n\nSend UNPAUSE to restore.`;
    }

    case "UNPAUSE": {
      await db.appSettings.update({
        where: { id: 1 },
        data: { autoExecutionEnabled: true },
      } as unknown);
      await db.agentHaltFlag.upsert({
        where: { id: 1 },
        create: { id: 1, halted: false, reason: null, setAt: new Date(), setBy: "USER" },
        update: { halted: false, reason: null, setAt: new Date(), setBy: "USER" },
      } as unknown);
      return `▶️ Auto-execution RESUMED\nAgent will enter new positions from the next cycle.`;
    }

    case "STATUS": {
      const ctx = await gatherContext();
      const lines = [
        `📊 STATUS — ${new Date().toISOString()}`,
        `━━━━━━━━━━━━━━━━━━`,
        `Halt:     ${ctx.haltFlag.halted ? `🛑 YES (${ctx.haltFlag.reason})` : "✓ Clear"}`,
        `Regime:   ${ctx.riskBudget.regimeBullish ? "BULL ✓" : "BEAR ✗"}`,
        `Drawdown: ${ctx.settings.drawdownState}`,
        ``,
        `Positions: ${ctx.riskBudget.openPositions}/${ctx.riskBudget.maxPositions}`,
        `Heat:      ${ctx.riskBudget.currentHeatPct}% / ${ctx.riskBudget.heatCapPct}%`,
        `Equity:    £${ctx.account?.equity?.toFixed(2) ?? "unknown"}`,
        ``,
        `Pending signals: ${ctx.pendingSignals.length}`,
        ctx.openPositions.length > 0
          ? ctx.openPositions
              .map((p) => `  ${p.ticker} | Stop: ${p.currentStop}`)
              .join("\n")
          : "  No open positions",
      ];
      return lines.join("\n");
    }

    default:
      return `❓ Unknown command: ${cmd}\n\nAvailable: HALT, RESUME, PAUSE, UNPAUSE, STATUS`;
  }
}

async function sendReply(botToken: string, chatId: string, message: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });
}

async function main(): Promise<void> {
  const BASE_URL = process.env["TRADECORE_BASE_URL"] ?? "http://localhost:3000";

  const settings = await db.telegramSettings.findFirst();
  if (!settings?.["enabled"] || !settings?.["botToken"]) {
    console.log("[TelegramListener] Telegram not configured or disabled.");
    process.exit(0);
  }

  const botToken = settings["botToken"] as string;
  const chatId = String(settings["chatId"]);

  const offset = getOffset();
  const updates = await getUpdates(botToken, offset);

  if (updates.length === 0) {
    process.exit(0);
  }

  let maxUpdateId = offset;

  for (const update of updates) {
    const u = update as Record<string, unknown>;
    const updateId = u["update_id"] as number;
    maxUpdateId = Math.max(maxUpdateId, updateId + 1);

    const message = u["message"] as Record<string, unknown> | undefined;
    const text = message?.["text"] as string | undefined;
    const fromChatId = String(
      (message?.["chat"] as Record<string, unknown> | undefined)?.["id"]
    );

    if (!text || fromChatId !== chatId) continue;

    console.log(`[TelegramListener] Command: ${text}`);

    try {
      const reply = await processCommand(text, BASE_URL);
      await sendReply(botToken, chatId, reply);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[TelegramListener] Error:", msg);
      await sendReply(botToken, chatId, `❌ Error: ${msg}`).catch(() => {});
    }
  }

  saveOffset(maxUpdateId);
  process.exit(0);
}

main().catch((err) => {
  console.error("[TelegramListener] Fatal:", err);
  process.exit(1);
});
