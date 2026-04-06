/**
 * Universe Health Report
 *
 * Run via: npm run universe:health
 *
 * Validates every ticker in the combined universe against data quality
 * rules. Outputs a summary report to console and saves to
 * logs/universe-health-{date}.txt
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getUniverse } from "../src/lib/universe/tickers";
import { fetchEODQuotes } from "../src/lib/data/fetchQuotes";
import { validateTicker } from "../src/lib/signals/dataValidator";
import * as fs from "fs";
import * as path from "path";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const adapter = new PrismaPg({ connectionString });
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

const todayStr = new Date().toISOString().slice(0, 10);

async function main() {
  const universe = getUniverse();
  console.log(`\nLoading quotes for ${universe.length} tickers…\n`);

  const quoteMap = await fetchEODQuotes(universe);
  const fetchedTickers = Object.keys(quoteMap);

  let sufficientHistory = 0;
  let insufficientHistory = 0;
  let zeroVolume = 0;
  let staleData = 0;
  let priceAnomaly = 0;
  let splitSuspected = 0;
  let extremeMove = 0;
  let totalWarnings = 0;
  let passing1M = 0;
  let failing1M = 0;

  const blocked: Array<{ ticker: string; flags: string[] }> = [];
  const warned: Array<{ ticker: string; warnings: string[] }> = [];

  for (const ticker of fetchedTickers) {
    const quotes = quoteMap[ticker]!;
    const candles = quotes.map((q) => ({
      date: q.date,
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume,
    }));

    const validation = await validateTicker(ticker, candles, null);

    if (candles.length >= 5) sufficientHistory++;
    else insufficientHistory++;

    // Check liquidity ($1M gate)
    if (candles.length >= 20) {
      const last20 = candles.slice(-20);
      const avgDolVol =
        last20.reduce((sum, c) => sum + c.close * c.volume, 0) / last20.length;
      if (avgDolVol >= 1_000_000) passing1M++;
      else failing1M++;
    } else {
      failing1M++;
    }

    if (!validation.valid) {
      blocked.push({ ticker, flags: validation.flags });
      for (const f of validation.flags) {
        if (f.startsWith("ZERO_VOLUME")) zeroVolume++;
        if (f.startsWith("STALE_DATA")) staleData++;
        if (f.startsWith("PRICE_ANOMALY")) priceAnomaly++;
        if (f.startsWith("SPLIT_SUSPECTED")) splitSuspected++;
        if (f.startsWith("EXTREME_MOVE")) extremeMove++;
        if (f.startsWith("INSUFFICIENT_HISTORY")) insufficientHistory++;
      }
    }

    if (validation.warnings.length > 0) {
      totalWarnings += validation.warnings.length;
      warned.push({ ticker, warnings: validation.warnings });
    }
  }

  const noData = universe.length - fetchedTickers.length;

  const lines: string[] = [];
  const w = (line: string) => {
    console.log(line);
    lines.push(line);
  };

  w(`\n  UNIVERSE HEALTH REPORT — ${todayStr}`);
  w("  =====================================");
  w(`  Total tickers:        ${universe.length}`);
  w(`  Data fetched:         ${fetchedTickers.length} (${noData} no data)`);
  w(`  Sufficient history:   ${sufficientHistory}  (${((sufficientHistory / fetchedTickers.length) * 100).toFixed(0)}%)`);
  w(`  Insufficient history: ${insufficientHistory}  (${((insufficientHistory / fetchedTickers.length) * 100).toFixed(0)}%)`);
  w(`  Zero volume:          ${zeroVolume}  (${((zeroVolume / fetchedTickers.length) * 100).toFixed(0)}%)`);
  w(`  Stale data:           ${staleData}  (${((staleData / fetchedTickers.length) * 100).toFixed(0)}%)`);
  w(`  Price anomalies:      ${priceAnomaly}`);
  w(`  Split suspected:      ${splitSuspected}`);
  w(`  Extreme moves:        ${extremeMove}`);
  w("");
  w("  LIQUIDITY CHECK (last 20d avg dollar volume):");
  w(`  Passing $1M gate:     ${passing1M}  (${((passing1M / fetchedTickers.length) * 100).toFixed(0)}%)`);
  w(`  Failing $1M gate:     ${failing1M}  (${((failing1M / fetchedTickers.length) * 100).toFixed(0)}%)`);
  w("");
  w(`  VALIDATION SUMMARY:`);
  w(`  Blocked tickers:      ${blocked.length}`);
  w(`  Warnings:             ${totalWarnings}`);

  if (blocked.length > 0) {
    w("");
    w("  BLOCKED TICKERS:");
    for (const b of blocked.slice(0, 30)) {
      w(`    ${b.ticker.padEnd(8)} ${b.flags.join("; ")}`);
    }
    if (blocked.length > 30) {
      w(`    … +${blocked.length - 30} more`);
    }
  }

  if (failing1M > universe.length * 0.25) {
    w("");
    w("  RECOMMENDATION:");
    w(`  ${((failing1M / fetchedTickers.length) * 100).toFixed(0)}% of universe failing liquidity gate.`);
    w(`  Consider pruning ~${Math.round(failing1M * 0.5)} tickers from HIGH_RISK_UNIVERSE.`);
  }

  w("  =====================================\n");

  // Save to file
  const logsDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const outPath = path.join(logsDir, `universe-health-${todayStr}.txt`);
  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`  Report saved to ${outPath}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[universeHealth] Fatal error:", err);
    process.exit(1);
  });
