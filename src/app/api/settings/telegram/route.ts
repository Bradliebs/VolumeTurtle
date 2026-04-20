import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { sendTelegram } from "@/lib/telegram";
import { telegramSettingsSchema, validateBody } from "@/lib/validation";

const db = prisma as unknown as {
  telegramSettings: {
    findFirst: (args: unknown) => Promise<{
      id: number;
      botToken: string;
      chatId: string;
      enabled: boolean;
    } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const settings = await db.telegramSettings.findFirst({
    orderBy: { id: "asc" },
  });

  return NextResponse.json({
    configured: settings != null,
    enabled: settings?.enabled ?? false,
    chatId: settings?.chatId ? `***${settings.chatId.slice(-4)}` : null,
  });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  const parsed = await validateBody(req, telegramSettingsSchema);
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const { botToken, chatId, enabled, sendTest } = parsed.data ?? {};

  if (sendTest) {
    try {
      await sendTelegram({ text: "TradeCore test message — Telegram integration is working." });
      return NextResponse.json({ success: true, message: "Test message sent" });
    } catch (err) {
      return NextResponse.json(
        { success: false, error: String(err) },
        { status: 500 },
      );
    }
  }

  if (!botToken || !chatId) {
    return NextResponse.json(
      { error: "botToken and chatId are required" },
      { status: 400 },
    );
  }

  await db.telegramSettings.upsert({
    where: { id: 1 },
    create: {
      botToken,
      chatId,
      enabled: enabled ?? true,
    },
    update: {
      botToken,
      chatId,
      enabled: enabled ?? true,
    },
  });

  return NextResponse.json({ saved: true });
}
