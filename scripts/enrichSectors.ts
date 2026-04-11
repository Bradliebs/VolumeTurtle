/**
 * Enrich universe.csv sector data from Yahoo Finance quoteSummary.
 * Only processes rows with sector "Unknown" or empty.
 * Safe to run multiple times — checkpoints every 50 batches.
 *
 * Usage:  npx tsx scripts/enrichSectors.ts
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import YahooFinance from "yahoo-finance2";
import { normaliseSector } from "../src/lib/universe/sectorMap";

const CSV_PATH = path.join(process.cwd(), "data", "universe.csv");
const BATCH_SIZE = 5;
const DELAY_MS = 300;

const yahooFinance = new YahooFinance();

interface CsvRow {
  ticker: string;
  name: string;
  sector: string;
  market_cap: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeCsv(filePath: string, header: string, rows: CsvRow[]): void {
  const lines = [
    header,
    ...rows.map((r) => `${r.ticker},${r.name},${r.sector},${r.market_cap}`),
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
}

async function main() {
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const lines = raw.trim().split(/\r?\n/);
  const header = lines[0]!;
  const rows: CsvRow[] = lines.slice(1).map((line) => {
    const [ticker, name, sector, market_cap] = line.split(",");
    return {
      ticker: ticker?.trim() ?? "",
      name: name?.trim() ?? "",
      sector: sector?.trim() ?? "",
      market_cap: market_cap?.trim() ?? "0",
    };
  });

  const toEnrich = rows.filter(
    (r) => !r.sector || r.sector === "Unknown" || r.sector === "",
  );

  console.log(`Total rows:      ${rows.length}`);
  console.log(`Need enrichment: ${toEnrich.length}`);
  console.log(`Already set:     ${rows.length - toEnrich.length}`);

  if (toEnrich.length === 0) {
    console.log("\nNothing to enrich — all rows have sectors.");
    return;
  }

  console.log("Starting enrichment...\n");

  const batches: CsvRow[][] = [];
  for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
    batches.push(toEnrich.slice(i, i + BATCH_SIZE));
  }

  let enriched = 0;
  let failed = 0;
  let unknown = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!;

    if (i % 20 === 0) {
      const pct = ((i / batches.length) * 100).toFixed(0);
      console.log(
        `Batch ${i + 1}/${batches.length} (${pct}%) — ` +
        `✓ ${enriched} ✗ ${failed} ? ${unknown}`,
      );
    }

    await Promise.allSettled(
      batch.map(async (row) => {
        try {
          const result = await yahooFinance.quoteSummary(row.ticker, {
            modules: ["assetProfile"],
          });

          const yahooSector = result.assetProfile?.sector ?? "";
          const normalised = normaliseSector(yahooSector);

          const idx = rows.findIndex((r) => r.ticker === row.ticker);
          if (idx !== -1) {
            rows[idx]!.sector = normalised;
            if (normalised !== "Unknown") {
              enriched++;
            } else {
              unknown++;
            }
          }
        } catch {
          failed++;
        }
      }),
    );

    await sleep(DELAY_MS);

    // Checkpoint every 50 batches
    if (i % 50 === 0 && i > 0) {
      writeCsv(CSV_PATH, header, rows);
      console.log(`  Checkpoint saved at batch ${i + 1}`);
    }
  }

  // Final write
  writeCsv(CSV_PATH, header, rows);

  console.log("\n── Enrichment complete ────────────────");
  console.log(`✓ Enriched: ${enriched}`);
  console.log(`? Unknown:  ${unknown} (Yahoo had no sector data)`);
  console.log(`✗ Failed:   ${failed} (API errors)`);
  console.log("\nuniverse.csv updated.");
}

main().catch(console.error);
