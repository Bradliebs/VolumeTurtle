import "dotenv/config";
import { prisma } from "@/db/client";

const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<Array<{ id: string; ticker: string; status: string; entryPrice: number; shares: number }>>;
    findFirst: (args: unknown) => Promise<{ id: string; ticker: string } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  dailyQuote: {
    findFirst: (args: unknown) => Promise<{ close: number; date: Date } | null>;
  };
};

async function main() {
  const tickers = ["ATAI", "HRMY"];
  const exitReason = "GHOST_POSITION — T212 reconciliation";
  const now = new Date();

  for (const ticker of tickers) {
    const trade = await db.trade.findFirst({
      where: { ticker, status: "OPEN" },
      orderBy: { entryDate: "desc" },
    });
    if (!trade) {
      console.log(`[skip] ${ticker} — no OPEN trade found`);
      continue;
    }
    const lastQuote = await db.dailyQuote.findFirst({
      where: { ticker },
      orderBy: { date: "desc" },
    });
    if (!lastQuote) {
      console.log(`[warn] ${ticker} — no DailyQuote found, skipping`);
      continue;
    }
    await db.trade.update({
      where: { id: trade.id },
      data: {
        status: "CLOSED",
        exitDate: now,
        exitPrice: lastQuote.close,
        exitReason,
      },
    });
    console.log(`[closed] ${ticker} (id=${trade.id}) @ ${lastQuote.close} (quote ${lastQuote.date.toISOString().slice(0, 10)})`);
  }

  const remaining = await db.trade.findMany({
    where: { status: "OPEN" },
    orderBy: { ticker: "asc" },
  });
  console.log(`\nOPEN trades remaining (${remaining.length}):`);
  for (const t of remaining) {
    console.log(`  - ${t.ticker} (id=${t.id}, shares=${t.shares}, entry=${t.entryPrice})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
  });
