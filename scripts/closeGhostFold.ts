import "dotenv/config";
import { prisma } from "@/db/client";

const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<
      Array<{ id: string; ticker: string; status: string; entryDate: Date; entryPrice: number }>
    >;
    update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  ticker: {
    findUnique: (args: unknown) => Promise<{ id: number } | null>;
  };
  dailyQuote: {
    findFirst: (args: unknown) => Promise<{ date: Date; close: number } | null>;
  };
};

async function main() {
  const open = await db.trade.findMany({
    where: { ticker: "FOLD", status: "OPEN" },
  } as unknown);

  if (open.length === 0) {
    console.log("No OPEN FOLD trade found.");
    return;
  }

  const ticker = await db.ticker.findUnique({ where: { symbol: "FOLD" } } as unknown);
  if (!ticker) {
    throw new Error("Ticker FOLD not found in DB");
  }

  const lastQuote = await db.dailyQuote.findFirst({
    where: { tickerId: ticker.id },
    orderBy: { date: "desc" },
    select: { date: true, close: true },
  } as unknown);

  if (!lastQuote) {
    throw new Error("No DailyQuote found for FOLD");
  }

  const exitDate = new Date();
  const exitReason = "GHOST_POSITION — closed by T212, reconciled manually";

  for (const trade of open) {
    console.log(
      `Closing ${trade.id} (FOLD) — entry ${trade.entryPrice} on ${trade.entryDate.toISOString()} → exit ${lastQuote.close} (last quote ${lastQuote.date.toISOString().slice(0, 10)})`,
    );
    await db.trade.update({
      where: { id: trade.id },
      data: {
        status: "CLOSED",
        exitDate,
        exitPrice: lastQuote.close,
        exitReason,
      },
    });
    console.log(`  ✓ Trade ${trade.id} closed.`);
  }
}

main()
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
