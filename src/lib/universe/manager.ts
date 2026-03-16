import { prisma } from "@/db/client";
import { createLogger } from "@/lib/logger";

const log = createLogger("universe");

/**
 * Return all active tickers in the scan universe.
 */
export async function getActiveUniverse() {
  try {
    return await prisma.ticker.findMany({
      where: { active: true },
      orderBy: { symbol: "asc" },
    });
  } catch (err) {
    log.error({ err }, "Failed to fetch active universe");
    return [];
  }
}

/**
 * Add a ticker to the universe.
 */
export async function addTicker(symbol: string, name?: string, sector?: string) {
  if (!symbol || symbol.trim().length === 0) {
    throw new Error("Ticker symbol cannot be empty");
  }
  return prisma.ticker.upsert({
    where: { symbol: symbol.trim().toUpperCase() },
    update: { active: true, name, sector },
    create: { symbol: symbol.trim().toUpperCase(), name, sector },
  });
}

/**
 * Soft-remove a ticker from the universe.
 */
export async function removeTicker(symbol: string) {
  try {
    return await prisma.ticker.update({
      where: { symbol },
      data: { active: false },
    });
  } catch (err) {
    log.error({ symbol, err }, "Failed to remove ticker");
    throw err;
  }
}
