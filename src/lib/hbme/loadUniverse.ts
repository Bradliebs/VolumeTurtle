import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import type { UniverseRow } from "@/lib/hbme/types";
import { getUniverse } from "@/lib/universe/tickers";

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Load the combined momentum universe.
 * Merges data/universe.csv (has sector/name metadata) with the full
 * volume engine ticker list from tickers.ts (~1,200 tickers).
 * CSV rows provide sector/name; tickers only in the volume engine
 * get sector "Unknown".
 */
export async function loadUniverse(): Promise<UniverseRow[]> {
  // 1. Parse CSV for metadata
  const csvPath = path.join(process.cwd(), "data", "universe.csv");
  const raw = await fs.readFile(csvPath, "utf8");

  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  if (parsed.errors.length > 0) {
    throw new Error(`Failed to parse universe.csv: ${parsed.errors[0]?.message ?? "unknown error"}`);
  }

  const csvRows = parsed.data
    .map((row) => ({
      ticker: (row.ticker ?? "").trim().toUpperCase(),
      name: (row.name ?? "").trim(),
      sector: (row.sector ?? "Unknown").trim(),
      market_cap: toNumber(row.market_cap),
    }))
    .filter((row) => row.ticker.length > 0);

  // 2. Build lookup from CSV
  const csvMap = new Map<string, UniverseRow>();
  for (const row of csvRows) {
    csvMap.set(row.ticker, row);
  }

  // 3. Merge with volume engine universe
  const volumeTickers = getUniverse();
  const seen = new Set<string>();
  const combined: UniverseRow[] = [];

  // Add all CSV rows first (they have metadata)
  for (const row of csvRows) {
    if (!seen.has(row.ticker)) {
      seen.add(row.ticker);
      combined.push(row);
    }
  }

  // Add volume engine tickers not already in CSV
  for (const ticker of volumeTickers) {
    if (!seen.has(ticker)) {
      seen.add(ticker);
      combined.push({ ticker, name: "", sector: "Unknown", market_cap: 0 });
    }
  }

  return combined;
}
