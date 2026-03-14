import { prisma } from "@/db/client";

/**
 * Return all active tickers in the scan universe.
 */
export async function getActiveUniverse() {
  return prisma.ticker.findMany({
    where: { active: true },
    orderBy: { symbol: "asc" },
  });
}

/**
 * Add a ticker to the universe.
 */
export async function addTicker(symbol: string, name?: string, sector?: string) {
  return prisma.ticker.upsert({
    where: { symbol },
    update: { active: true, name, sector },
    create: { symbol, name, sector },
  });
}

/**
 * Soft-remove a ticker from the universe.
 */
export async function removeTicker(symbol: string) {
  return prisma.ticker.update({
    where: { symbol },
    data: { active: false },
  });
}
