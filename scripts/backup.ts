/**
 * Backup script — saves full JSON + trades CSV to local folder.
 * Keeps 30 days of rolling backups.
 *
 * Usage:
 *   npx tsx scripts/backup.ts
 *   npm run backup
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

const BACKUP_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  "VolumeTurtle",
  "backups",
);

const KEEP_DAYS = 30;

export async function runBackup(): Promise<{
  backupPath: string;
  csvPath: string;
  tradeCount: number;
  deletedOldFiles: number;
}> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const today = new Date().toISOString().split("T")[0];

  // Full JSON backup
  const [trades, scanResults, scanRuns, accountSnapshots, settings] =
    await Promise.all([
      prisma.trade.findMany({ include: { stopHistory: true } }),
      prisma.scanResult.findMany(),
      prisma.scanRun.findMany(),
      prisma.accountSnapshot.findMany(),
      prisma.settings.findMany(),
    ]);

  const backup = {
    exportedAt: new Date().toISOString(),
    version: "1.0",
    tables: { trades, scanResults, scanRuns, accountSnapshots, settings },
  };

  const backupPath = path.join(BACKUP_DIR, `volumeturtle_backup_${today}.json`);
  const jsonReplacer = (_key: string, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value;
  fs.writeFileSync(backupPath, JSON.stringify(backup, jsonReplacer, 2));
  console.log(`✓ Backup saved: ${backupPath}`);

  // Trades CSV
  const csvHeaders = [
    "ticker", "entryDate", "entryPrice", "shares",
    "hardStop", "exitDate", "exitPrice", "rMultiple",
    "status", "volumeRatio",
  ];
  const csvRows = trades.map((t) => [
    t.ticker,
    t.entryDate.toISOString().split("T")[0],
    t.entryPrice,
    t.shares,
    t.hardStop,
    t.exitDate?.toISOString().split("T")[0] ?? "",
    t.exitPrice ?? "",
    t.rMultiple ?? "",
    t.status,
    t.volumeRatio,
  ]);

  const csv = [
    csvHeaders.join(","),
    ...csvRows.map((r) => r.map((v) => {
      const str = String(v);
      return `"${str.replace(/"/g, '""')}"`;
    }).join(",")),
  ].join("\n");

  const csvPath = path.join(BACKUP_DIR, `volumeturtle_trades_${today}.csv`);
  fs.writeFileSync(csvPath, csv);
  console.log(`✓ Trades CSV saved: ${csvPath}`);

  // Save last backup timestamp to settings
  await prisma.settings.upsert({
    where: { key: "last_backup_at" },
    create: { key: "last_backup_at", value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  // Clean up old backups
  const files = fs.readdirSync(BACKUP_DIR);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);

  let deleted = 0;
  for (const file of files) {
    const filePath = path.join(BACKUP_DIR, file);
    const stat = fs.statSync(filePath);
    if (stat.mtime < cutoff) {
      fs.unlinkSync(filePath);
      deleted++;
    }
  }

  if (deleted > 0) {
    console.log(`✓ Cleaned up ${deleted} old backup files`);
  }

  return { backupPath, csvPath, tradeCount: trades.length, deletedOldFiles: deleted };
}

// Run if called directly
if (require.main === module) {
  runBackup()
    .then((result) => {
      console.log("\nBackup complete:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Backup failed:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
