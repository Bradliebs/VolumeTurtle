import { prisma } from "@/db/client";
import { config } from "@/lib/config";

const db = prisma as unknown as {
  telegramSettings: {
    findFirst: (args: { orderBy: { id: "asc" } }) => Promise<{
      botToken: string;
      chatId: string;
      enabled: boolean;
    } | null>;
  };
};

interface TelegramMessage {
  text: string;
  parseMode?: "HTML" | "Markdown";
}

interface AlertFormatInput {
  type: string;
  ticker: string;
  message: string;
  signalSource?: "volume" | "momentum" | string;
  price?: number | null;
  stopPrice?: number | null;
  grade?: "A" | "B" | "C" | "D";
  totalScore?: number;
  regimeScore?: number;
  sector?: string;
  sectorRank?: number;
  chgPct?: number;
  volRatio?: number;
}

export async function sendTelegram(message: TelegramMessage): Promise<void> {
  const persisted = await db.telegramSettings.findFirst({ orderBy: { id: "asc" } });
  const enabled = persisted?.enabled ?? true;
  if (!enabled) return;

  const botToken = persisted?.botToken ?? config.TELEGRAM_BOT_TOKEN;
  const chatId = persisted?.chatId ?? config.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const MAX_LENGTH = 4000; // Telegram limit is 4096; leave margin for safety
  const text = message.text;

  // Split long messages into chunks at line boundaries
  const chunks: string[] = [];
  if (text.length <= MAX_LENGTH) {
    chunks.push(text);
  } else {
    let remaining = text;
    let _part = 1;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }
      // Find a line break near the limit to split cleanly
      let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
      if (splitAt < MAX_LENGTH * 0.5) splitAt = MAX_LENGTH; // no good break found
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
      _part++;
    }
  }

  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: message.parseMode ?? "HTML",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telegram send failed: ${err}`);
    }
  }
}

export async function formatAlertMessage(alert: AlertFormatInput): Promise<string> {
  if (alert.type === "STOP_BREACH") {
    return (
      `<b>STOP BREACH</b>\n` +
      `<code>${alert.ticker}</code> hit stop at <b>$${alert.price?.toFixed(2) ?? "-"}</b>\n` +
      `Stop: $${alert.stopPrice?.toFixed(2) ?? "-"}`
    );
  }

  if (alert.type === "DATA_QUALITY") {
    return (
      `<b>⚠ DATA QUALITY FLAG</b>\n` +
      `<code>${alert.ticker}</code> excluded from scan\n` +
      `Reason: ${alert.message}\n` +
      `Raw move: ${((alert.chgPct ?? 0) * 100).toFixed(1)}%\n` +
      `<i>Verify manually before acting on this ticker</i>`
    );
  }

  if (alert.type === "BREAKOUT_TRIGGER") {
    if (alert.grade && alert.totalScore != null) {
      return (
        `<b>BREAKOUT SIGNAL ${alert.grade}</b>\n` +
        `<code>${alert.ticker}</code> +${((alert.chgPct ?? 0) * 100).toFixed(1)}% vol ${(alert.volRatio ?? 0).toFixed(1)}x\n` +
        `Score: ${alert.totalScore.toFixed(2)} | Regime: ${alert.regimeScore ?? 0}/3\n` +
        `Sector: ${alert.sector ?? "Unknown"} (rank ${alert.sectorRank ?? "-"})`
      );
    }

    return (
      `<b>BREAKOUT SIGNAL</b>\n` +
      `<code>${alert.ticker}</code>\n` +
      `${alert.message}`
    );
  }

  return alert.message;
}
