import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { loadT212Settings, getCachedT212Positions } from "../src/lib/t212/client";
import {
  findDuplicateClosedEntryIds,
  findDuplicateClosedTradeIds,
  findPhantomClosedTradeIds,
} from "../src/lib/trades/status";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const tickerFilter = args.find((arg) => arg.startsWith("--ticker="))?.split("=")[1]?.trim().toUpperCase() ?? null;

type HeldPosition = {
  ticker: string;
  quantity: number;
  averagePrice: number;
  stopLoss?: number | null;
};

function formatMoney(value: number | null | undefined): string {
  if (value == null) return "n/a";
  return value.toFixed(2);
}

async function main() {
  const settings = loadT212Settings();
  let allHeldPositions: HeldPosition[] = [];
  let t212Loaded = false;

  if (settings) {
    try {
      const cached = await getCachedT212Positions(settings);
      allHeldPositions = cached.positions
        .filter((position) => tickerFilter == null || position.ticker.toUpperCase() === tickerFilter)
        .map((position) => ({
          ticker: position.ticker,
          quantity: position.quantity,
          averagePrice: position.averagePrice,
          stopLoss: position.stopLoss ?? null,
        } satisfies HeldPosition));
      t212Loaded = true;
    } catch (error) {
      console.warn(`Trading 212 holdings unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.warn("Trading 212 is not configured. Only duplicate open/closed twins can be repaired.");
  }

  const [openTrades, closedTrades] = await Promise.all([
    prisma.trade.findMany({
      where: {
        status: "OPEN",
        ...(tickerFilter ? { ticker: tickerFilter } : {}),
      },
      select: { id: true, ticker: true, entryDate: true, entryPrice: true, shares: true },
    }),
    prisma.trade.findMany({
      where: {
        status: "CLOSED",
        ...(tickerFilter ? { ticker: tickerFilter } : {}),
        exitReason: { not: "MANUAL" },
      },
      orderBy: [{ exitDate: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        ticker: true,
        entryDate: true,
        createdAt: true,
        exitDate: true,
        entryPrice: true,
        shares: true,
        hardStop: true,
        trailingStop: true,
        trailingStopPrice: true,
        exitPrice: true,
        exitReason: true,
      },
    }),
  ]);

  if (openTrades.length === 0 && closedTrades.length === 0) {
    console.log(tickerFilter
      ? `No trades found for ${tickerFilter}.`
      : "No trades found to inspect.");
    return;
  }

  const heldTickers = allHeldPositions.map((position) => position.ticker);

  const phantomIds = t212Loaded
    ? findPhantomClosedTradeIds({
      openTrades,
      closedTrades,
      heldTickers,
    })
    : new Set<string>();
  const duplicateIds = findDuplicateClosedTradeIds({
    openTrades,
    closedTrades,
  });
  const duplicateClosedEntryIds = findDuplicateClosedEntryIds(closedTrades);

  const reopenCandidates = closedTrades.filter((trade) => phantomIds.has(trade.id) && !duplicateIds.has(trade.id));
  const deleteCandidates = closedTrades.filter((trade) => duplicateIds.has(trade.id) || duplicateClosedEntryIds.has(trade.id));

  if (reopenCandidates.length === 0 && deleteCandidates.length === 0) {
    console.log("No false-closed trades found to repair.");
    return;
  }

  console.log(apply ? "Repair plan:" : "Dry run:");
  for (const trade of reopenCandidates) {
    const held = allHeldPositions.find((position) => position.ticker === trade.ticker);
    const currentStop = Math.max(trade.hardStop, trade.trailingStop);
    const repairedStop = held?.stopLoss != null && held.stopLoss > currentStop
      ? held.stopLoss
      : currentStop;
    console.log([
      `- ${trade.ticker}`,
      `trade=${trade.id}`,
      `closed=${trade.exitDate?.toISOString().slice(0, 10) ?? "unknown"}`,
      `reason=${trade.exitReason ?? "unknown"}`,
      `shares ${formatMoney(trade.shares)} -> ${formatMoney(held?.quantity)}`,
      `entry ${formatMoney(trade.entryPrice)} -> ${formatMoney(held?.averagePrice)}`,
      `stop ${formatMoney(currentStop)} -> ${formatMoney(repairedStop)}`,
    ].join(" | "));
  }

  for (const trade of deleteCandidates) {
    console.log([
      `- ${trade.ticker}`,
      `trade=${trade.id}`,
      "action=delete false closed twin",
      `closed=${trade.exitDate?.toISOString().slice(0, 10) ?? "unknown"}`,
      `reason=${trade.exitReason ?? "unknown"}`,
    ].join(" | "));
  }

  if (!apply) {
    console.log("\nRe-run with --apply to reopen these trades.");
    return;
  }

  const now = new Date();
  const repaired: Array<{ ticker: string; tradeId: string }> = [];

  for (const trade of reopenCandidates) {
    const held = allHeldPositions.find((position) => position.ticker === trade.ticker);
    if (!held) continue;

    const currentStop = Math.max(trade.hardStop, trade.trailingStop);
    const repairedStop = held.stopLoss != null && held.stopLoss > currentStop
      ? held.stopLoss
      : currentStop;

    await prisma.$transaction(async (tx) => {
      await tx.trade.update({
        where: { id: trade.id },
        data: {
          status: "OPEN",
          exitDate: null,
          exitPrice: null,
          exitReason: null,
          rMultiple: null,
          shares: held.quantity,
          entryPrice: held.averagePrice,
          trailingStop: repairedStop,
          trailingStopPrice: repairedStop,
          lastSyncedAt: now,
        },
      });

      await tx.stopHistory.create({
        data: {
          tradeId: trade.id,
          date: now,
          stopLevel: repairedStop,
          stopType: repairedStop > trade.hardStop ? "TRAILING" : "HARD",
          changed: repairedStop > currentStop,
          changeAmount: repairedStop > currentStop ? repairedStop - currentStop : null,
          actioned: held.stopLoss != null && held.stopLoss >= repairedStop,
          actionedAt: held.stopLoss != null && held.stopLoss >= repairedStop ? now : null,
          note: `Reopened by false-close repair on ${now.toISOString()} after Trading 212 still showed the position held.`,
        },
      });
    });

    repaired.push({ ticker: trade.ticker, tradeId: trade.id });
  }

  for (const trade of deleteCandidates) {
    await prisma.trade.delete({ where: { id: trade.id } });
    repaired.push({ ticker: trade.ticker, tradeId: trade.id });
  }

  console.log(`\nRepaired ${repaired.length} trade(s).`);
  for (const item of repaired) {
    const action = deleteCandidates.some((trade) => trade.id === item.tradeId) ? "deleted false closed twin" : "reopened";
    console.log(`- ${item.ticker} (${item.tradeId}) ${action}`);
  }
}

main()
  .catch((error) => {
    console.error("False-close repair failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });