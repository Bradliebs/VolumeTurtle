/**
 * Apply: deactivate DB tickers not tradeable on T212.
 * Skips any ticker with an open trade or pending order.
 */
import "dotenv/config";
import { prisma } from "../src/db/client";
import { loadT212Settings, getInstruments, type T212Instrument } from "../src/lib/t212/client";

function t212ToYahoo(inst: T212Instrument): string {
  const short = inst.shortName;
  if (inst.currencyCode === "GBX" || inst.currencyCode === "GBP") return `${short}.L`;
  if (inst.currencyCode === "EUR" && inst.ticker.endsWith("l_EQ")) return `${short}.AS`;
  return short;
}

async function main() {
  const db = prisma as unknown as {
    ticker: {
      findMany: (args: unknown) => Promise<Array<{ id: number; symbol: string }>>;
      updateMany: (args: unknown) => Promise<{ count: number }>;
    };
    trade: { findMany: (args: unknown) => Promise<Array<{ ticker: string }>> };
    pendingOrder: { findMany: (args: unknown) => Promise<Array<{ ticker: string }>> };
  };

  const settings = await loadT212Settings();
  if (!settings) { console.error("T212 settings missing"); process.exit(1); }

  console.log("Fetching T212 instruments...");
  const instruments = await getInstruments(settings);
  const yahooSet = new Set<string>();
  for (const inst of instruments) yahooSet.add(t212ToYahoo(inst));
  console.log(`  → ${yahooSet.size} unique Yahoo tickers mapped\n`);

  const tickers = await db.ticker.findMany({ where: { active: true }, orderBy: { symbol: "asc" } });
  const openTrades = await db.trade.findMany({ where: { status: "OPEN" }, select: { ticker: true } });
  const openSet = new Set(openTrades.map((t) => t.ticker));
  const pending = await db.pendingOrder.findMany({
    where: { status: { in: ["NEW", "PENDING", "AWAITING_FILL"] } },
    select: { ticker: true },
  });
  const pendingSet = new Set(pending.map((p) => p.ticker));

  const toDeactivate: string[] = [];
  const skippedBlocked: string[] = [];
  for (const t of tickers) {
    if (yahooSet.has(t.symbol)) continue;
    if (openSet.has(t.symbol) || pendingSet.has(t.symbol)) {
      skippedBlocked.push(t.symbol);
    } else {
      toDeactivate.push(t.symbol);
    }
  }

  console.log(`Will deactivate: ${toDeactivate.length}`);
  console.log(`Skipped (blocked): ${skippedBlocked.length}`);
  if (skippedBlocked.length > 0) console.log("  " + skippedBlocked.join(", "));

  if (toDeactivate.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const result = await db.ticker.updateMany({
    where: { symbol: { in: toDeactivate } },
    data: { active: false },
  });

  console.log(`\n✅ Deactivated ${result.count} tickers (active=false).`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
