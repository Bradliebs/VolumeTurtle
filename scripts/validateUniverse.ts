// Validates data/universe.csv — checks for duplicate tickers
// and invalid sector values.
// Run with: npm run validate:universe

import fs from "fs";
import path from "path";
import Papa from "papaparse";

const ALLOWED_SECTORS = [
  "Technology",
  "Biotech",
  "Healthcare",
  "Energy",
  "Financial Services",
  "Consumer Discretionary",
  "Industrials",
  "Real Estate",
];

interface UniverseRow {
  ticker: string;
  name: string;
  sector: string;
  market_cap: string;
}

const csvPath = path.resolve(__dirname, "..", "data", "universe.csv");
const csvText = fs.readFileSync(csvPath, "utf-8");
const { data } = Papa.parse<UniverseRow>(csvText, {
  header: true,
  skipEmptyLines: true,
});

let issues = 0;

// Check for duplicate tickers
const seen = new Map<string, number>();
for (const row of data) {
  const count = (seen.get(row.ticker) ?? 0) + 1;
  seen.set(row.ticker, count);
}
for (const [ticker, count] of seen) {
  if (count > 1) {
    console.log(`DUPLICATE: ${ticker} appears ${count} times`);
    issues++;
  }
}

// Check sector values
const sectorsFound = new Set<string>();
for (const row of data) {
  sectorsFound.add(row.sector);
  if (!ALLOWED_SECTORS.includes(row.sector)) {
    console.log(`BAD SECTOR: "${row.sector}" on ticker ${row.ticker}`);
    issues++;
  }
}

console.log(
  `\n${data.length} tickers, ${sectorsFound.size} sectors, ${issues} issues found`,
);
