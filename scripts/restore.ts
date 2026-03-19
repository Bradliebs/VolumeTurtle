/**
 * Restore from a full JSON backup.
 *
 * Usage:
 *   npx tsx scripts/restore.ts --file="path/to/backup.json"
 *   npx tsx scripts/restore.ts --file="path/to/backup.json" --dry-run
 */
import "dotenv/config";
import fs from "fs";
import readline from "readline";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

const args = process.argv.slice(2);
const fileArg = args.find((a) => a.startsWith("--file="));
const dryRun = args.includes("--dry-run");
const filePath = fileArg?.split("=")[1];

if (!filePath) {
  console.error('Usage: npx tsx scripts/restore.ts --file="path/to/backup.json"');
  console.error("Add --dry-run to preview without writing");
  process.exit(1);
}

async function restore() {
  console.log(`Reading backup: ${filePath}`);
  const raw = fs.readFileSync(filePath!, "utf-8");
  const backup = JSON.parse(raw);

  console.log(`Backup date: ${backup.exportedAt}`);
  console.log(`Version: ${backup.version}`);
  console.log(`Trades: ${backup.tables.trades?.length ?? 0}`);
  console.log(`Scan results: ${backup.tables.scanResults?.length ?? 0}`);
  console.log(`Scan runs: ${backup.tables.scanRuns?.length ?? 0}`);
  console.log(`Account snapshots: ${backup.tables.accountSnapshots?.length ?? 0}`);
  console.log(`Settings: ${backup.tables.settings?.length ?? 0}`);

  if (dryRun) {
    console.log("\n--- DRY RUN — no changes written ---");
    return;
  }

  // Prompt for confirmation before destructive operation
  const confirmed = await new Promise<boolean>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question("\n⚠️  WARNING: This will DELETE ALL existing data and replace it.\nType 'CONFIRM' to proceed: ", (answer) => {
      rl.close();
      resolve(answer.trim() === "CONFIRM");
    });
  });

  if (!confirmed) {
    console.log("Restore cancelled.");
    return;
  }

  console.log("\nRestoring... (this will replace all existing data)");

  // Clear tables in dependency order
  await prisma.stopHistory.deleteMany();
  await prisma.trade.deleteMany();
  await prisma.scanResult.deleteMany();
  await prisma.scanRun.deleteMany();
  await prisma.accountSnapshot.deleteMany();

  // Restore trades with stop history
  for (const trade of backup.tables.trades ?? []) {
    const { stopHistory, ...tradeData } = trade;
    await prisma.trade.create({
      data: {
        ...tradeData,
        entryDate: new Date(tradeData.entryDate),
        exitDate: tradeData.exitDate ? new Date(tradeData.exitDate) : null,
        createdAt: new Date(tradeData.createdAt),
        updatedAt: new Date(tradeData.updatedAt),
        stopHistory: {
          create: (stopHistory ?? []).map((s: Record<string, unknown>) => ({
            id: s.id as string,
            date: new Date(s.date as string),
            stopLevel: s.stopLevel as number,
            stopType: s.stopType as string,
            changed: s.changed as boolean,
            changeAmount: s.changeAmount as number | null,
            actioned: (s.actioned as boolean) ?? false,
            actionedAt: s.actionedAt ? new Date(s.actionedAt as string) : null,
            createdAt: new Date(s.createdAt as string),
          })),
        },
      },
    });
  }
  console.log(`✓ Restored ${backup.tables.trades?.length ?? 0} trades`);

  // Restore scan results
  for (const sr of backup.tables.scanResults ?? []) {
    await prisma.scanResult.create({
      data: {
        ...sr,
        scanDate: new Date(sr.scanDate),
        createdAt: new Date(sr.createdAt),
      },
    });
  }
  console.log(`✓ Restored ${backup.tables.scanResults?.length ?? 0} scan results`);

  // Restore scan runs
  for (const run of backup.tables.scanRuns ?? []) {
    await prisma.scanRun.create({
      data: {
        ...run,
        startedAt: new Date(run.startedAt),
        completedAt: run.completedAt ? new Date(run.completedAt) : null,
      },
    });
  }
  console.log(`✓ Restored ${backup.tables.scanRuns?.length ?? 0} scan runs`);

  // Restore account snapshots
  for (const snap of backup.tables.accountSnapshots ?? []) {
    await prisma.accountSnapshot.create({
      data: {
        ...snap,
        date: new Date(snap.date),
        createdAt: new Date(snap.createdAt),
      },
    });
  }
  console.log(`✓ Restored ${backup.tables.accountSnapshots?.length ?? 0} snapshots`);

  console.log("\nRestore complete.");
}

restore()
  .catch((err) => {
    console.error("Restore failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
