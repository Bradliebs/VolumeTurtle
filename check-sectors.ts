import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "./src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<Array<{ id: string; ticker: string; sector: string | null; status: string }>>;
    update: (args: { where: { id: string }; data: { sector: string } }) => Promise<unknown>;
  };
};

function loadSectorMap(): Record<string, string> {
  const csvPath = path.resolve(__dirname, "data", "universe.csv");
  const csv = fs.readFileSync(csvPath, "utf8");
  const map: Record<string, string> = {};
  for (const line of csv.split("\n").slice(1)) {
    const parts = line.split(",");
    const ticker = parts[0]?.trim();
    const sector = parts[2]?.trim();
    if (ticker && sector) map[ticker] = sector;
  }
  return map;
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const checkOnly = process.argv.includes("--check");

  if (checkOnly) {
    // Just show current sector state of open trades
    const open = await db.trade.findMany({ where: { status: "OPEN" } });
    console.log(`\n${open.length} open trades:`);
    for (const t of open) {
      console.log(`  ${t.ticker.padEnd(10)} sector: ${t.sector ?? "NULL"}`);
    }

    // Also check for SIDU duplicates
    const sidus = await db.trade.findMany({ where: { ticker: "SIDU" } });
    if (sidus.length > 1) {
      console.log(`\n⚠ SIDU has ${sidus.length} trade entries:`);
      for (const s of sidus) {
        console.log(`  id=${s.id}  status=${s.status}  entry=${new Date((s as unknown as {entryDate:Date}).entryDate).toISOString().slice(0,10)}`);
      }
    }

    await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
    return;
  }

  const sectorMap = loadSectorMap();
  console.log(`Loaded ${Object.keys(sectorMap).length} tickers from universe.csv`);

  const trades = await db.trade.findMany({
    where: { sector: null },
  });

  console.log(`Found ${trades.length} trades with no sector\n`);

  let updated = 0;
  let skipped = 0;

  for (const t of trades) {
    const sector = sectorMap[t.ticker];
    if (!sector) {
      console.log(`  SKIP  ${t.ticker.padEnd(10)} — not in universe.csv`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`  [DRY] ${t.ticker.padEnd(10)} → ${sector}  (${t.status})`);
    } else {
      await db.trade.update({ where: { id: t.id }, data: { sector } });
      console.log(`  SET   ${t.ticker.padEnd(10)} → ${sector}  (${t.status})`);
    }
    updated++;
  }

  console.log(`\n${dryRun ? "[DRY RUN] " : ""}${updated} updated, ${skipped} skipped`);
  if (dryRun && updated > 0) {
    console.log("Run with --apply to write changes");
  }

  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
}

main().catch(console.error);