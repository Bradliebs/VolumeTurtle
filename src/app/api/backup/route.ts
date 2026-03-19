import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit } from "@/lib/rateLimit";
import fs from "fs";
import path from "path";

const BACKUP_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || ".",
  "VolumeTurtle",
  "backups",
);

const KEEP_DAYS = 30;

export async function POST() {
  // Rate limit: max 5 backups per minute
  const limited = rateLimit("backup", 5, 60_000);
  if (limited) return limited;

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const today = new Date().toISOString().split("T")[0];

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

    // Trades CSV
    const csvHeaders = ["ticker", "entryDate", "entryPrice", "shares", "hardStop", "exitDate", "exitPrice", "rMultiple", "status", "volumeRatio"];
    const csvRows = trades.map((t) => [
      t.ticker, t.entryDate.toISOString().split("T")[0], t.entryPrice, t.shares, t.hardStop,
      t.exitDate?.toISOString().split("T")[0] ?? "", t.exitPrice ?? "", t.rMultiple ?? "", t.status, t.volumeRatio,
    ]);
    const csv = [csvHeaders.join(","), ...csvRows.map((r) => r.map((v) => {
      const str = String(v);
      return `"${str.replace(/"/g, '""')}"`;
    }).join(","))].join("\n");
    const csvPath = path.join(BACKUP_DIR, `volumeturtle_trades_${today}.csv`);
    fs.writeFileSync(csvPath, csv);

    // Update last backup timestamp
    await prisma.settings.upsert({
      where: { key: "last_backup_at" },
      create: { key: "last_backup_at", value: new Date().toISOString() },
      update: { value: new Date().toISOString() },
    });

    // Clean old backups
    const files = fs.readdirSync(BACKUP_DIR);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
    let deleted = 0;
    for (const file of files) {
      const fp = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(fp);
      if (stat.mtime < cutoff) {
        fs.unlinkSync(fp);
        deleted++;
      }
    }

    return NextResponse.json({
      success: true,
      backupPath,
      csvPath,
      tradeCount: trades.length,
      signalCount: scanResults.length,
      deletedOldFiles: deleted,
      backupDir: BACKUP_DIR,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backup failed" },
      { status: 500 },
    );
  }
}

export async function GET() {
  const lastBackup = await prisma.settings.findUnique({
    where: { key: "last_backup_at" },
  });

  return NextResponse.json({
    lastBackupAt: lastBackup?.value ?? null,
    backupDir: BACKUP_DIR,
  });
}
