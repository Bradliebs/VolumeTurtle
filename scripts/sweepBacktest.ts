// Backtest parameter sweep harness.
//
// Runs the backtest engine across a grid of parameter combinations,
// persists each as its own BacktestRun (with a descriptive label), and
// prints a ranked leaderboard at the end.
//
// Selection is robustness-aware: we score each run by a composite that
// rewards profit factor and trade count while penalising drawdown. This
// resists the "cherry-pick the best PF on N=3 trades" failure mode.
//
// Usage:
//   npx tsx scripts/sweepBacktest.ts --start 2024-04-18 --end 2026-04-18
//   npx tsx scripts/sweepBacktest.ts --start 2024-04-18 --end 2026-04-18 --capital 10000 --quick
//
// Flags:
//   --start <YYYY-MM-DD>   Required.
//   --end   <YYYY-MM-DD>   Required.
//   --capital <number>     Default 10000.
//   --use-snapshots        Use UniverseSnapshot for survivorship-bias-free runs.
//   --quick                Smaller grid (8 combos) for fast iteration.
//   --csv <path>           Also dump leaderboard to CSV.

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { runBacktestEndToEnd } from "../src/lib/backtest";
import { prisma } from "../src/db/client";

interface Args {
  start: string;
  end: string;
  capital: number;
  useSnapshots: boolean;
  quick: boolean;
  csv?: string;
}

function parseArgs(): Args {
  const out: Args = {
    start: "",
    end: "",
    capital: 10000,
    useSnapshots: false,
    quick: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--start": out.start = next!; i++; break;
      case "--end": out.end = next!; i++; break;
      case "--capital": out.capital = Number(next); i++; break;
      case "--use-snapshots": out.useSnapshots = true; break;
      case "--quick": out.quick = true; break;
      case "--csv": out.csv = next!; i++; break;
    }
  }
  if (!out.start || !out.end) {
    console.error("Required: --start <YYYY-MM-DD> --end <YYYY-MM-DD>");
    process.exit(1);
  }
  return out;
}

// Grade-floor enforced via conviction multipliers: lower grades get 0
// risk, which causes the engine to skip them (shares = 0 → continue).
type GradeFloor = "any" | "C" | "B" | "A";
function multipliersFor(floor: GradeFloor): { A: number; B: number; C: number; D: number } {
  switch (floor) {
    case "A": return { A: 1.0, B: 0, C: 0, D: 0 };
    case "B": return { A: 1.5, B: 1.0, C: 0, D: 0 };
    case "C": return { A: 1.5, B: 1.2, C: 1.0, D: 0 };
    case "any": return { A: 1.5, B: 1.2, C: 1.0, D: 0.6 };
  }
}

interface Combo {
  gradeFloor: GradeFloor;
  riskPct: number;
  heatCap: number;
  sectorCap: number;
}

function buildGrid(quick: boolean): Combo[] {
  const grades: GradeFloor[] = quick ? ["B", "C"] : ["A", "B", "C", "any"];
  const risks = quick ? [0.01] : [0.0075, 0.01, 0.015];
  const heats = quick ? [0.08, 0.12] : [0.05, 0.08, 0.12];
  const sectors = quick ? [2, 3] : [2, 3, 5];
  const out: Combo[] = [];
  for (const g of grades) for (const r of risks) for (const h of heats) for (const s of sectors) {
    out.push({ gradeFloor: g, riskPct: r, heatCap: h, sectorCap: s });
  }
  return out;
}

function comboLabel(c: Combo): string {
  return `sweep G=${c.gradeFloor} risk=${(c.riskPct * 100).toFixed(2)}% heat=${(c.heatCap * 100).toFixed(0)}% sec=${c.sectorCap}`;
}

interface RunOutcome {
  combo: Combo;
  runId: number | null;
  trades: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  totalReturnPct: number;
  cagrPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  finalEquity: number;
  score: number;
}

/**
 * Robustness-aware composite score. We want strategies that:
 *   - have a positive profit factor
 *   - generated enough trades to be statistically meaningful
 *   - didn't punch a huge drawdown to get there
 *
 * Score = (profitFactor − 1) × log(1 + trades) × CAGR / (maxDD + 5%)
 *
 * The +5% floor on DD prevents division blowups and rewards low-DD runs
 * without infinitely favouring near-zero DD.
 */
function scoreOutcome(o: Omit<RunOutcome, "score">): number {
  if (o.trades < 5) return -Infinity; // too few to trust
  const pfEdge = Math.max(0, o.profitFactor - 1);
  const cagr = Math.max(0, o.cagrPct / 100);
  const ddFloor = Math.max(0.05, o.maxDrawdownPct / 100);
  return pfEdge * Math.log(1 + o.trades) * cagr / ddFloor;
}

async function main() {
  const args = parseArgs();
  const grid = buildGrid(args.quick);

  console.log(`\nSweep: ${grid.length} combinations`);
  console.log(`Window: ${args.start} → ${args.end}  Capital: £${args.capital}`);
  console.log(`Universe mode: ${args.useSnapshots ? "snapshots (survivorship-safe)" : "live tickers"}`);
  console.log("");

  const outcomes: RunOutcome[] = [];

  for (let i = 0; i < grid.length; i++) {
    const combo = grid[i]!;
    const label = comboLabel(combo);
    process.stdout.write(`[${i + 1}/${grid.length}] ${label} … `);
    const t0 = Date.now();
    try {
      const { runId, result } = await runBacktestEndToEnd({
        start: args.start,
        end: args.end,
        capital: args.capital,
        useSnapshots: args.useSnapshots,
        riskPctPerTrade: combo.riskPct,
        portfolioHeatCapPct: combo.heatCap,
        maxPositionsPerSector: combo.sectorCap,
        convictionMultipliers: multipliersFor(combo.gradeFloor),
        label,
        persist: true,
      });
      const s = result.summary;
      const partial = {
        combo,
        runId,
        trades: s.trades,
        winRate: s.winRate,
        profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : 0,
        expectancyR: s.expectancyR,
        totalReturnPct: s.totalReturnPct,
        cagrPct: s.cagrPct,
        sharpe: s.sharpe,
        maxDrawdownPct: s.maxDrawdownPct,
        finalEquity: s.finalEquity,
      };
      const score = scoreOutcome(partial);
      outcomes.push({ ...partial, score });
      const ms = Date.now() - t0;
      console.log(`done in ${(ms / 1000).toFixed(1)}s — trades=${s.trades} PF=${partial.profitFactor.toFixed(2)} DD=${s.maxDrawdownPct.toFixed(1)}% score=${score.toFixed(3)}`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Leaderboard ──────────────────────────────────────────────────────
  outcomes.sort((a, b) => b.score - a.score);

  console.log("\n══════════════ TOP 10 BY ROBUSTNESS SCORE ══════════════\n");
  const header =
    "rank".padStart(4) +
    "  " + "label".padEnd(40) +
    "  " + "trd".padStart(4) +
    "  " + "win%".padStart(6) +
    "  " + "PF".padStart(6) +
    "  " + "expR".padStart(7) +
    "  " + "ret%".padStart(7) +
    "  " + "CAGR%".padStart(7) +
    "  " + "DD%".padStart(6) +
    "  " + "score".padStart(7) +
    "  " + "runId".padStart(6);
  console.log(header);
  console.log("─".repeat(header.length));
  outcomes.slice(0, 10).forEach((o, i) => {
    console.log(
      String(i + 1).padStart(4) +
      "  " + comboLabel(o.combo).padEnd(40) +
      "  " + String(o.trades).padStart(4) +
      "  " + `${(o.winRate * 100).toFixed(1)}%`.padStart(6) +
      "  " + o.profitFactor.toFixed(2).padStart(6) +
      "  " + o.expectancyR.toFixed(3).padStart(7) +
      "  " + o.totalReturnPct.toFixed(2).padStart(7) +
      "  " + o.cagrPct.toFixed(2).padStart(7) +
      "  " + o.maxDrawdownPct.toFixed(2).padStart(6) +
      "  " + o.score.toFixed(3).padStart(7) +
      "  " + String(o.runId ?? "—").padStart(6)
    );
  });

  // ── Robustness check: did the top configuration's neighbours also score well? ──
  // Only count neighbours that produced enough trades to be meaningful —
  // otherwise -Infinity scores from no-trade combos poison the average.
  if (outcomes.length >= 3) {
    const best = outcomes[0]!;
    const neighbours = outcomes.filter((o) => {
      if (o === best) return false;
      if (!Number.isFinite(o.score)) return false;
      const c = o.combo;
      const b = best.combo;
      let diffs = 0;
      if (c.gradeFloor !== b.gradeFloor) diffs++;
      if (c.riskPct !== b.riskPct) diffs++;
      if (c.heatCap !== b.heatCap) diffs++;
      if (c.sectorCap !== b.sectorCap) diffs++;
      return diffs === 1;
    });
    const avgNeighbourScore = neighbours.length > 0
      ? neighbours.reduce((s, o) => s + o.score, 0) / neighbours.length
      : 0;
    const robustness = best.score > 0 ? avgNeighbourScore / best.score : 0;
    console.log(`\nRobustness check: best=${best.score.toFixed(3)}, avg-1-step neighbour=${avgNeighbourScore.toFixed(3)} across ${neighbours.length} valid neighbours (ratio ${robustness.toFixed(2)})`);
    if (neighbours.length === 0) {
      console.log("  ⚠️  No valid neighbours to compare — cannot assess robustness.");
    } else if (robustness < 0.5) {
      console.log("  ⚠️  Best combo is an isolated peak — likely overfit. Prefer #2 or #3 if their neighbours are stronger.");
    } else {
      console.log("  ✅ Best combo sits on a stable plateau.");
    }
  }

  // ── CSV dump ─────────────────────────────────────────────────────────
  if (args.csv) {
    const lines = ["rank,gradeFloor,riskPct,heatCap,sectorCap,trades,winRate,profitFactor,expectancyR,totalReturnPct,cagrPct,sharpe,maxDrawdownPct,finalEquity,score,runId"];
    outcomes.forEach((o, i) => {
      lines.push([
        i + 1,
        o.combo.gradeFloor,
        o.combo.riskPct,
        o.combo.heatCap,
        o.combo.sectorCap,
        o.trades,
        o.winRate.toFixed(4),
        o.profitFactor.toFixed(4),
        o.expectancyR.toFixed(4),
        o.totalReturnPct.toFixed(4),
        o.cagrPct.toFixed(4),
        o.sharpe.toFixed(4),
        o.maxDrawdownPct.toFixed(4),
        o.finalEquity.toFixed(2),
        o.score.toFixed(4),
        o.runId ?? "",
      ].join(","));
    });
    writeFileSync(args.csv, lines.join("\n"));
    console.log(`\nWrote ${outcomes.length} runs to ${args.csv}`);
  }

  console.log("\nAll runs persisted to BacktestRun. Drill in via: npm run backtest:analyze -- --run=<id>\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
