/**
 * Nightly scan script — fetches history for all active tickers,
 * runs signal detection, and persists results.
 *
 * Usage:  npx tsx scripts/nightly-scan.ts
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import YahooFinance from "yahoo-finance2";
import { detectVolumeSpike } from "../src/lib/signals/volume-spike";
import { calculatePosition } from "../src/lib/risk/position-sizer";
import type { HistoricalBar } from "../src/lib/data/yahoo";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;
const yahooFinance = new YahooFinance();

const LOOKBACK_DAYS = 60;
const DEFAULT_ACCOUNT_SIZE = 100_000;
const DEFAULT_RISK_PERCENT = 0.01;

async function main() {
  console.log("[nightly-scan] Starting…");

  // Record the scan run
  const run = await prisma.scanRun.create({ data: {} });

  try {
    const tickers = await prisma.ticker.findMany({
      where: { active: true },
      orderBy: { symbol: "asc" },
    });

    console.log(`[nightly-scan] Scanning ${tickers.length} tickers`);

    let signalsFound = 0;

    for (const ticker of tickers) {
      try {
        const period1 = new Date();
        period1.setDate(period1.getDate() - LOOKBACK_DAYS);

        const history = await yahooFinance.historical(ticker.symbol, {
          period1,
          period2: new Date(),
          interval: "1d",
          events: "history",
        });

        const bars: HistoricalBar[] = history.map((bar) => ({
          date: bar.date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          adjClose: bar.adjClose ?? bar.close,
          volume: bar.volume,
        }));

        // Persist quotes
        for (const bar of bars) {
          await prisma.dailyQuote.upsert({
            where: {
              tickerId_date: { tickerId: ticker.id, date: bar.date },
            },
            update: {
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              adjClose: bar.adjClose,
              volume: BigInt(bar.volume),
            },
            create: {
              tickerId: ticker.id,
              date: bar.date,
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              adjClose: bar.adjClose,
              volume: BigInt(bar.volume),
            },
          });
        }

        // Detect signals
        const signal = detectVolumeSpike(ticker.symbol, bars);
        if (signal) {
          const saved = await prisma.signal.create({
            data: {
              tickerId: ticker.id,
              date: signal.date,
              type: signal.type,
              strength: signal.strength,
              metadata: signal.metadata ?? undefined,
            },
          });

          // Calculate risk/position sizing
          const lastBar = bars[bars.length - 1];
          if (lastBar) {
            const atr = computeATR(bars, 14);
            const stopPrice = lastBar.close - 2 * atr;

            const calc = calculatePosition({
              entryPrice: lastBar.close,
              stopPrice,
              accountSize: DEFAULT_ACCOUNT_SIZE,
              riskPercent: DEFAULT_RISK_PERCENT,
            });

            await prisma.riskCalc.create({
              data: {
                signalId: saved.id,
                entryPrice: calc.entryPrice,
                stopPrice: calc.stopPrice,
                targetPrice: calc.targetPrice,
                positionSize: calc.positionSize,
                riskAmount: calc.riskAmount,
                riskReward: calc.riskReward,
              },
            });
          }

          signalsFound++;
          console.log(
            `  [SIGNAL] ${ticker.symbol} — ${signal.type} (strength: ${signal.strength.toFixed(2)})`,
          );
        }
      } catch (err) {
        console.error(`  [ERROR] ${ticker.symbol}:`, err);
      }
    }

    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        completedAt: new Date(),
        tickersScanned: tickers.length,
        signalsFound,
        status: "COMPLETED",
      },
    });

    console.log(
      `[nightly-scan] Done — ${tickers.length} tickers scanned, ${signalsFound} signals found`,
    );
  } catch (err) {
    await prisma.scanRun.update({
      where: { id: run.id },
      data: {
        completedAt: new Date(),
        status: "FAILED",
        error: String(err),
      },
    });
    console.error("[nightly-scan] Fatal error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Simple ATR (Average True Range) over `period` bars.
 */
function computeATR(bars: HistoricalBar[], period: number): number {
  if (bars.length < period + 1) return 0;

  const recent = bars.slice(-(period + 1));
  let trSum = 0;

  for (let i = 1; i < recent.length; i++) {
    const curr = recent[i]!;
    const prev = recent[i - 1]!;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trSum += tr;
  }

  return trSum / period;
}

main();
