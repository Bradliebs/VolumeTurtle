// Walk-forward validation: trains a winning config on rolling in-sample
// windows, then tests it on the immediately-following out-of-sample window.
// Honest answer to "does this edge survive on data we didn't tune on?"
//
// Default protocol: 12-month train → 3-month test, step forward by test size.
//
// For each fold:
//   1. Run the sweep over the train window
//   2. Pick the winner by robustness score
//   3. Re-run that single config on the test window (no peeking)
//   4. Record train PF, test PF, winner combo, fold dates
//
// At the end:
//   - Average test PF (the only number that matters)
//   - Stability: did the winning combo stay similar across folds?
//   - Decay ratio: avg(test PF) / avg(train PF)
//
// Usage:
//   npx tsx scripts/walkForward.ts                            # default 2y backtest, 12mo train, 3mo test
//   npx tsx scripts/walkForward.ts --train 12 --test 3 --years 2
//   npx tsx scripts/walkForward.ts --quick                    # quick grid per fold

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runBacktestEndToEnd } from "../src/lib/backtest";
import { prisma } from "../src/db/client";

interface Args {
  trainMonths: number;
  testMonths: number;
  years: number;
  quick: boolean;
  capital: number;
}

function parseArgs(): Args {
  const out: Args = { trainMonths: 12, testMonths: 3, years: 2, quick: false, capital: 10000 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--train": out.trainMonths = Number(next); i++; break;
      case "--test": out.testMonths = Number(next); i++; break;
      case "--years": out.years = Number(next); i++; break;
      case "--quick": out.quick = true; break;
      case "--capital": out.capital = Number(next); i++; break;
    }
  }
  return out;
}

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
  const grades: GradeFloor[] = quick ? ["B"] : ["B", "C"];
  const risks = quick ? [0.01] : [0.0075, 0.01, 0.015];
  const heats = quick ? [0.08] : [0.05, 0.08, 0.12];
  const sectors = [2]; // sector cap doesn't bind at observed trade frequency
  const out: Combo[] = [];
  for (const g of grades) for (const r of risks) for (const h of heats) for (const s of sectors) {
    out.push({ gradeFloor: g, riskPct: r, heatCap: h, sectorCap: s });
  }
  return out;
}

function comboLabel(c: Combo): string {
  return `G=${c.gradeFloor} risk=${(c.riskPct * 100).toFixed(2)}% heat=${(c.heatCap * 100).toFixed(0)}% sec=${c.sectorCap}`;
}

function comboKey(c: Combo): string {
  return `${c.gradeFloor}|${c.riskPct}|${c.heatCap}|${c.sectorCap}`;
}

interface RunResult {
  trades: number;
  profitFactor: number;
  expectancyR: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  score: number;
}

function scoreOutcome(o: RunResult): number {
  if (o.trades < 5) return -Infinity;
  const pfEdge = Math.max(0, o.profitFactor - 1);
  const cagr = Math.max(0, o.cagrPct / 100);
  const ddFloor = Math.max(0.05, o.maxDrawdownPct / 100);
  return pfEdge * Math.log(1 + o.trades) * cagr / ddFloor;
}

async function runOne(opts: {
  start: string;
  end: string;
  capital: number;
  combo: Combo;
  label: string;
}): Promise<RunResult & { runId: number | null }> {
  const { runId, result } = await runBacktestEndToEnd({
    start: opts.start,
    end: opts.end,
    capital: opts.capital,
    riskPctPerTrade: opts.combo.riskPct,
    portfolioHeatCapPct: opts.combo.heatCap,
    maxPositionsPerSector: opts.combo.sectorCap,
    convictionMultipliers: multipliersFor(opts.combo.gradeFloor),
    label: opts.label,
    persist: true,
  });
  const s = result.summary;
  const partial: RunResult = {
    trades: s.trades,
    profitFactor: Number.isFinite(s.profitFactor) ? s.profitFactor : 0,
    expectancyR: s.expectancyR,
    totalReturnPct: s.totalReturnPct,
    cagrPct: s.cagrPct,
    maxDrawdownPct: s.maxDrawdownPct,
    score: 0,
  };
  partial.score = scoreOutcome(partial);
  return { ...partial, runId };
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, m: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + m);
  return out;
}

interface Fold {
  index: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  winnerCombo: Combo;
  trainResult: RunResult;
  testResult: RunResult;
}

async function main() {
  const args = parseArgs();
  const grid = buildGrid(args.quick);

  const overallEnd = new Date();
  const overallStart = addMonths(overallEnd, -args.years * 12);

  // Build folds: each fold is [train ↦ test], stepping by testMonths
  const folds: { trainStart: Date; trainEnd: Date; testStart: Date; testEnd: Date }[] = [];
  let cursor = new Date(overallStart);
  while (true) {
    const trainStart = new Date(cursor);
    const trainEnd = addMonths(trainStart, args.trainMonths);
    const testStart = new Date(trainEnd);
    const testEnd = addMonths(testStart, args.testMonths);
    if (testEnd > overallEnd) break;
    folds.push({ trainStart, trainEnd, testStart, testEnd });
    cursor = addMonths(cursor, args.testMonths);
  }

  if (folds.length === 0) {
    console.error(`Not enough data for walk-forward: need ≥ ${args.trainMonths + args.testMonths}mo, have ${args.years * 12}mo`);
    process.exit(1);
  }

  console.log(`\nWalk-forward: ${folds.length} folds`);
  console.log(`Window: ${dateOnly(overallStart)} → ${dateOnly(overallEnd)}`);
  console.log(`Protocol: ${args.trainMonths}mo train → ${args.testMonths}mo test, step ${args.testMonths}mo`);
  console.log(`Grid per fold: ${grid.length} combos`);
  console.log(`Total runs: ${folds.length * (grid.length + 1)} (≈ ${Math.round(folds.length * (grid.length + 1) * 4 / 60)} min)\n`);

  const results: Fold[] = [];

  for (let fi = 0; fi < folds.length; fi++) {
    const f = folds[fi]!;
    const trainStart = dateOnly(f.trainStart);
    const trainEnd = dateOnly(f.trainEnd);
    const testStart = dateOnly(f.testStart);
    const testEnd = dateOnly(f.testEnd);

    console.log(`── Fold ${fi + 1}/${folds.length}  train ${trainStart} → ${trainEnd}  test ${testStart} → ${testEnd} ──`);

    // 1. Sweep on train window
    const trainResults: { combo: Combo; result: RunResult }[] = [];
    for (let ci = 0; ci < grid.length; ci++) {
      const combo = grid[ci]!;
      process.stdout.write(`  train [${ci + 1}/${grid.length}] ${comboLabel(combo)} … `);
      try {
        const r = await runOne({
          start: trainStart,
          end: trainEnd,
          capital: args.capital,
          combo,
          label: `wf fold${fi + 1} train ${comboLabel(combo)}`,
        });
        trainResults.push({ combo, result: r });
        console.log(`PF=${r.profitFactor.toFixed(2)} score=${r.score.toFixed(2)}`);
      } catch (err) {
        console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (trainResults.length === 0) {
      console.log(`  ⚠️  No valid train runs — skipping fold`);
      continue;
    }

    // 2. Pick winner by score
    trainResults.sort((a, b) => b.result.score - a.result.score);
    const winner = trainResults[0]!;
    console.log(`  → train winner: ${comboLabel(winner.combo)} (score ${winner.result.score.toFixed(2)})`);

    // 3. Test winner on next window
    process.stdout.write(`  test ${comboLabel(winner.combo)} on ${testStart} → ${testEnd} … `);
    try {
      const testResult = await runOne({
        start: testStart,
        end: testEnd,
        capital: args.capital,
        combo: winner.combo,
        label: `wf fold${fi + 1} TEST ${comboLabel(winner.combo)}`,
      });
      console.log(`trades=${testResult.trades} PF=${testResult.profitFactor.toFixed(2)} ret=${testResult.totalReturnPct.toFixed(2)}%`);

      results.push({
        index: fi + 1,
        trainStart,
        trainEnd,
        testStart,
        testEnd,
        winnerCombo: winner.combo,
        trainResult: winner.result,
        testResult,
      });
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log("");
  }

  // ── Summary ─────────────────────────────────────────────────────────
  if (results.length === 0) {
    console.error("No completed folds.");
    process.exit(1);
  }

  console.log("═══════════════ WALK-FORWARD RESULTS ═══════════════\n");
  console.log(
    "fold".padStart(4) +
    "  " + "train".padEnd(25) +
    "  " + "test".padEnd(25) +
    "  " + "winner".padEnd(35) +
    "  " + "trnPF".padStart(6) +
    "  " + "tstPF".padStart(6) +
    "  " + "tstTrd".padStart(6) +
    "  " + "tstRet%".padStart(8)
  );
  console.log("─".repeat(125));
  for (const r of results) {
    console.log(
      String(r.index).padStart(4) +
      "  " + `${r.trainStart} → ${r.trainEnd}`.padEnd(25) +
      "  " + `${r.testStart} → ${r.testEnd}`.padEnd(25) +
      "  " + comboLabel(r.winnerCombo).padEnd(35) +
      "  " + r.trainResult.profitFactor.toFixed(2).padStart(6) +
      "  " + r.testResult.profitFactor.toFixed(2).padStart(6) +
      "  " + String(r.testResult.trades).padStart(6) +
      "  " + r.testResult.totalReturnPct.toFixed(2).padStart(8)
    );
  }

  // ── Out-of-sample aggregates ────────────────────────────────────────
  const validTests = results.filter((r) => r.testResult.trades >= 1);
  const avgTrainPF = results.reduce((s, r) => s + r.trainResult.profitFactor, 0) / results.length;
  const avgTestPF = validTests.length > 0
    ? validTests.reduce((s, r) => s + r.testResult.profitFactor, 0) / validTests.length
    : 0;
  const decayRatio = avgTrainPF > 0 ? avgTestPF / avgTrainPF : 0;
  const totalTestTrades = validTests.reduce((s, r) => s + r.testResult.trades, 0);
  const totalTestReturn = validTests.reduce((s, r) => s + r.testResult.totalReturnPct, 0);
  const winningFolds = validTests.filter((r) => r.testResult.profitFactor > 1).length;

  // Stability: how often did the same combo win across folds?
  const comboCounts = new Map<string, number>();
  for (const r of results) {
    const k = comboKey(r.winnerCombo);
    comboCounts.set(k, (comboCounts.get(k) ?? 0) + 1);
  }
  const dominantCombo = [...comboCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const stability = dominantCombo ? dominantCombo[1] / results.length : 0;

  console.log(`\nAggregates:`);
  console.log(`  Avg train PF:       ${avgTrainPF.toFixed(2)}`);
  console.log(`  Avg test PF:        ${avgTestPF.toFixed(2)}  ← THE NUMBER THAT MATTERS`);
  console.log(`  Decay ratio:        ${decayRatio.toFixed(2)}  (1.0 = no decay; <0.7 = significant overfit)`);
  console.log(`  Winning folds:      ${winningFolds}/${validTests.length}  (${((winningFolds / Math.max(1, validTests.length)) * 100).toFixed(0)}%)`);
  console.log(`  Total test trades:  ${totalTestTrades}`);
  console.log(`  Sum of test ret:    ${totalTestReturn.toFixed(2)}%`);
  console.log(`  Stability:          ${(stability * 100).toFixed(0)}% of folds picked the same winner`);

  console.log(`\nVerdict:`);
  if (avgTestPF > 1.5 && decayRatio > 0.7 && stability >= 0.5) {
    console.log("  ✅ ROBUST EDGE — survives out-of-sample, low decay, stable winner. Safe to consider promoting.");
  } else if (avgTestPF > 1.0 && decayRatio > 0.5) {
    console.log("  🟡 MARGINAL — positive out-of-sample but some decay. Promote cautiously, monitor closely.");
  } else {
    console.log("  ❌ WEAK / OVERFIT — out-of-sample PF too low or decay too steep. Do not promote.");
  }

  // ── Persist results ─────────────────────────────────────────────────
  const wfDir = join(process.cwd(), "data", "walkforward");
  mkdirSync(wfDir, { recursive: true });
  const summary = {
    generatedAt: new Date().toISOString(),
    protocol: { trainMonths: args.trainMonths, testMonths: args.testMonths, years: args.years },
    grid: { combos: grid.length, quick: args.quick },
    folds: results,
    aggregates: {
      avgTrainPF,
      avgTestPF,
      decayRatio,
      winningFolds,
      totalFolds: validTests.length,
      totalTestTrades,
      totalTestReturn,
      stability,
      dominantCombo: dominantCombo ? dominantCombo[0] : null,
    },
  };
  const outPath = join(wfDir, `${dateOnly(new Date())}-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  writeFileSync(join(wfDir, "latest.json"), JSON.stringify(summary, null, 2));
  console.log(`\nWritten to: ${outPath}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
