// Validates the universe — checks which tickers Yahoo Finance
// can actually fetch data for, and which fail.
// Run with: npm run validate

import { HIGH_RISK_UNIVERSE } from "../src/lib/universe/tickers";
import { fetchEODQuotes } from "../src/lib/data/fetchQuotes";

async function validateUniverse() {
  console.log(`Validating ${HIGH_RISK_UNIVERSE.length} tickers...\n`);

  const results = await fetchEODQuotes(HIGH_RISK_UNIVERSE);

  const valid = Object.keys(results);
  const failed = HIGH_RISK_UNIVERSE.filter((t) => !valid.includes(t));

  console.log(`✓ Valid: ${valid.length} tickers`);
  console.log(`✗ Failed: ${failed.length} tickers\n`);

  if (failed.length > 0) {
    console.log("Failed tickers (remove or check symbol):");
    failed.forEach((t) => console.log(`  - ${t}`));
  }

  console.log("\nDone.");
}

validateUniverse();
