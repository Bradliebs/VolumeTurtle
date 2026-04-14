import * as fs from "fs";
import * as path from "path";

const CSV_PATH = path.join(process.cwd(), "data", "universe.csv");

/**
 * Ensure a ticker exists in data/universe.csv.
 * If missing, appends a row with the given sector (default "Technology")
 * and returns true. If already present, returns false.
 */
export function ensureTickerInCsv(
  ticker: string,
  sector: string = "Unknown",
): boolean {
  try {
    const raw = fs.readFileSync(CSV_PATH, "utf8");
    const lines = raw.split(/\r?\n/);

    // Check if ticker already exists (first column)
    for (const line of lines) {
      const first = line.split(",")[0]?.trim();
      if (first === ticker) return false;
    }

    // Append new row
    const row = `${ticker},${ticker},${sector},0`;
    fs.appendFileSync(CSV_PATH, `\n${row}`);
    console.log(`[Universe] Added ${ticker} to universe.csv with sector ${sector}`);
    return true;
  } catch (err) {
    console.error(`[Universe] Failed to append ${ticker} to CSV: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
