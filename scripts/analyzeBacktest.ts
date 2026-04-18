// Trade-quality breakdown for a completed BacktestRun.
//
// Slices the run's trades by grade, exit reason, sector, hold-time bucket,
// and entry month — printing trade count, win rate, expectancy (R), and
// profit factor for each slice. Highlights where the edge actually lives.
//
// Usage: npx tsx scripts/analyzeBacktest.ts --run=9
//        npx tsx scripts/analyzeBacktest.ts --run=9 --csv=out.csv

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { writeFileSync } from "node:fs";

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! });
const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

const args = process.argv.slice(2);
const runArg = args.find((a) => a.startsWith("--run="))?.split("=")[1];
const csvArg = args.find((a) => a.startsWith("--csv="))?.split("=")[1];

if (!runArg) {
  console.error("Usage: npx tsx scripts/analyzeBacktest.ts --run=<id> [--csv=path]");
  process.exit(1);
}

const runId = Number(runArg);
if (!Number.isFinite(runId)) {
  console.error(`Invalid --run value: ${runArg}`);
  process.exit(1);
}

interface TradeRow {
  ticker: string;
  entryDate: Date;
  rMultiple: number | null;
  pnlNet: number | null;
  exitReason: string | null;
  signalGrade: string | null;
  barsHeld: number | null;
  sector: string | null;
}

interface SliceStats {
  key: string;
  n: number;
  winRate: number;
  expectancyR: number;
  profitFactor: number;
  totalNetPnl: number;
}

function summarize(rows: TradeRow[], key: string): SliceStats {
  const n = rows.length;
  if (n === 0) {
    return { key, n: 0, winRate: 0, expectancyR: 0, profitFactor: 0, totalNetPnl: 0 };
  }
  let wins = 0;
  let sumR = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let totalNet = 0;
  let rCount = 0;
  for (const t of rows) {
    const pnl = t.pnlNet ?? 0;
    totalNet += pnl;
    if (pnl > 0) {
      wins += 1;
      grossWin += pnl;
    } else if (pnl < 0) {
      grossLoss += -pnl;
    }
    if (t.rMultiple != null) {
      sumR += t.rMultiple;
      rCount += 1;
    }
  }
  return {
    key,
    n,
    winRate: wins / n,
    expectancyR: rCount > 0 ? sumR / rCount : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    totalNetPnl: totalNet,
  };
}

function printTable(title: string, slices: SliceStats[]) {
  console.log(`\n── ${title} ──`);
  console.log(
    "key".padEnd(20) +
      "n".padStart(6) +
      "  win%".padStart(8) +
      "  expR".padStart(8) +
      "  PF".padStart(8) +
      "  net £".padStart(12)
  );
  for (const s of slices) {
    const pf = !Number.isFinite(s.profitFactor) ? "∞" : s.profitFactor.toFixed(2);
    console.log(
      s.key.padEnd(20) +
        String(s.n).padStart(6) +
        `  ${(s.winRate * 100).toFixed(1)}%`.padStart(8) +
        `  ${s.expectancyR.toFixed(3)}`.padStart(8) +
        `  ${pf}`.padStart(8) +
        `  ${s.totalNetPnl.toFixed(0)}`.padStart(12)
    );
  }
}

function bucketHold(bars: number | null): string {
  if (bars == null) return "?";
  if (bars <= 5) return "1-5d";
  if (bars <= 10) return "6-10d";
  if (bars <= 20) return "11-20d";
  if (bars <= 40) return "21-40d";
  return "40d+";
}

function groupBy<T>(rows: T[], keyFn: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

async function main() {
  const db = prisma as unknown as {
    backtestRun: {
      findUnique: (args: unknown) => Promise<null | {
        id: number;
        label: string | null;
        startDate: Date;
        endDate: Date;
        trades: number;
        profitFactor: number | null;
        expectancyR: number | null;
      }>;
    };
    backtestTrade: {
      findMany: (args: unknown) => Promise<Array<{
        ticker: string;
        entryDate: Date;
        rMultiple: number | null;
        pnlNet: number | null;
        exitReason: string | null;
        signalGrade: string | null;
        barsHeld: number | null;
      }>>;
    };
    ticker: {
      findMany: (args: unknown) => Promise<Array<{ symbol: string; sector: string | null }>>;
    };
  };

  const run = await db.backtestRun.findUnique({ where: { id: runId } });
  if (!run) {
    console.error(`BacktestRun #${runId} not found`);
    process.exit(1);
  }

  const trades = await db.backtestTrade.findMany({ where: { runId } });
  if (trades.length === 0) {
    console.error(`Run #${runId} has no trades`);
    process.exit(1);
  }

  const tickerSet = [...new Set(trades.map((t) => t.ticker))];
  const tickers = await db.ticker.findMany({ where: { symbol: { in: tickerSet } } });
  const sectorBy = new Map(tickers.map((t) => [t.symbol, t.sector]));

  const rows: TradeRow[] = trades.map((t) => ({
    ...t,
    sector: sectorBy.get(t.ticker) ?? null,
  }));

  console.log(`\nBacktestRun #${run.id} — ${run.label ?? "(no label)"}`);
  console.log(`Window: ${run.startDate.toISOString().slice(0, 10)} → ${run.endDate.toISOString().slice(0, 10)}`);
  console.log(`Total trades: ${rows.length}  PF: ${run.profitFactor?.toFixed(2)}  ExpR: ${run.expectancyR?.toFixed(3)}`);

  // ── By signal grade ──────────────────────────────────────────────────
  const byGrade = [...groupBy(rows, (r) => r.signalGrade ?? "?")]
    .map(([k, v]) => summarize(v, k))
    .sort((a, b) => a.key.localeCompare(b.key));
  printTable("BY GRADE", byGrade);

  // ── By exit reason ───────────────────────────────────────────────────
  const byExit = [...groupBy(rows, (r) => r.exitReason ?? "?")]
    .map(([k, v]) => summarize(v, k))
    .sort((a, b) => b.n - a.n);
  printTable("BY EXIT REASON", byExit);

  // ── By hold duration ─────────────────────────────────────────────────
  const byHold = [...groupBy(rows, (r) => bucketHold(r.barsHeld))]
    .map(([k, v]) => summarize(v, k))
    .sort((a, b) => {
      const order = ["1-5d", "6-10d", "11-20d", "21-40d", "40d+", "?"];
      return order.indexOf(a.key) - order.indexOf(b.key);
    });
  printTable("BY HOLD DURATION", byHold);

  // ── By sector (top 10 by N) ──────────────────────────────────────────
  const bySector = [...groupBy(rows, (r) => r.sector ?? "?")]
    .map(([k, v]) => summarize(v, k))
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);
  printTable("BY SECTOR (top 10 by N)", bySector);

  // ── By entry month ───────────────────────────────────────────────────
  const byMonth = [...groupBy(rows, (r) => r.entryDate.toISOString().slice(0, 7))]
    .map(([k, v]) => summarize(v, k))
    .sort((a, b) => a.key.localeCompare(b.key));
  printTable("BY ENTRY MONTH", byMonth);

  // ── Best/worst individual trades ─────────────────────────────────────
  const sortedByR = [...rows].filter((r) => r.rMultiple != null).sort((a, b) => (b.rMultiple ?? 0) - (a.rMultiple ?? 0));
  console.log("\n── TOP 5 WINNERS ──");
  for (const t of sortedByR.slice(0, 5)) {
    console.log(`  ${t.ticker.padEnd(10)} ${t.entryDate.toISOString().slice(0, 10)}  R=${t.rMultiple?.toFixed(2)}  grade=${t.signalGrade ?? "?"}`);
  }
  console.log("\n── TOP 5 LOSERS ──");
  for (const t of sortedByR.slice(-5).reverse()) {
    console.log(`  ${t.ticker.padEnd(10)} ${t.entryDate.toISOString().slice(0, 10)}  R=${t.rMultiple?.toFixed(2)}  grade=${t.signalGrade ?? "?"}`);
  }

  // ── Optional CSV dump ────────────────────────────────────────────────
  if (csvArg) {
    const lines = ["ticker,entryDate,grade,exitReason,barsHeld,sector,rMultiple,pnlNet"];
    for (const r of rows) {
      lines.push(
        [
          r.ticker,
          r.entryDate.toISOString().slice(0, 10),
          r.signalGrade ?? "",
          r.exitReason ?? "",
          r.barsHeld ?? "",
          r.sector ?? "",
          r.rMultiple ?? "",
          r.pnlNet ?? "",
        ].join(",")
      );
    }
    writeFileSync(csvArg, lines.join("\n"));
    console.log(`\nWrote ${rows.length} trades to ${csvArg}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
