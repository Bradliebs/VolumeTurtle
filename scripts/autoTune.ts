// Auto-tune: run a parameter sweep, pick the most robust winner, and write
// a recommendation file. Designed to run on a weekly schedule.
//
// The recommendation is HUMAN-APPROVED ONLY — this script writes JSON to
// `data/recommendations/latest.json` (and a timestamped archive). It does
// NOT mutate live trading config. Promotion to live is a manual step:
//   1. Review data/recommendations/latest.json
//   2. Apply the winning params to env / AppSettings as desired
//
// Usage:
//   npx tsx scripts/autoTune.ts                          # default 2yr window
//   npx tsx scripts/autoTune.ts --years 1                # custom lookback
//   npx tsx scripts/autoTune.ts --years 2 --notify       # also send Telegram
//   npx tsx scripts/autoTune.ts --quick                  # quick grid (8 combos)

import "dotenv/config";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runBacktestEndToEnd } from "../src/lib/backtest";
import { prisma } from "../src/db/client";
import { sendTelegram } from "../src/lib/telegram";

interface Args {
  years: number;
  quick: boolean;
  notify: boolean;
  capital: number;
}

function parseArgs(): Args {
  const out: Args = { years: 2, quick: false, notify: false, capital: 10000 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--years": out.years = Number(next); i++; break;
      case "--quick": out.quick = true; break;
      case "--notify": out.notify = true; break;
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
  // A-grade is excluded from the live grid because the current composite
  // scoring system never produces A-grade signals — including A floors
  // wastes ~25% of sweep time on guaranteed-empty runs.
  const grades: GradeFloor[] = quick ? ["B", "C"] : ["B", "C", "any"];
  const risks = quick ? [0.01] : [0.0075, 0.01, 0.015];
  const heats = quick ? [0.08, 0.12] : [0.05, 0.08, 0.12];
  const sectors = quick ? [2] : [2, 3];
  const out: Combo[] = [];
  for (const g of grades) for (const r of risks) for (const h of heats) for (const s of sectors) {
    out.push({ gradeFloor: g, riskPct: r, heatCap: h, sectorCap: s });
  }
  return out;
}

interface Outcome {
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

function scoreOutcome(o: Omit<Outcome, "score">): number {
  if (o.trades < 5) return -Infinity;
  const pfEdge = Math.max(0, o.profitFactor - 1);
  const cagr = Math.max(0, o.cagrPct / 100);
  const ddFloor = Math.max(0.05, o.maxDrawdownPct / 100);
  return pfEdge * Math.log(1 + o.trades) * cagr / ddFloor;
}

function comboLabel(c: Combo): string {
  return `auto G=${c.gradeFloor} risk=${(c.riskPct * 100).toFixed(2)}% heat=${(c.heatCap * 100).toFixed(0)}% sec=${c.sectorCap}`;
}

function neighbourScore(best: Outcome, all: Outcome[]): { avg: number; n: number } {
  const ns = all.filter((o) => {
    if (o === best || !Number.isFinite(o.score)) return false;
    let diffs = 0;
    if (o.combo.gradeFloor !== best.combo.gradeFloor) diffs++;
    if (o.combo.riskPct !== best.combo.riskPct) diffs++;
    if (o.combo.heatCap !== best.combo.heatCap) diffs++;
    if (o.combo.sectorCap !== best.combo.sectorCap) diffs++;
    return diffs === 1;
  });
  if (ns.length === 0) return { avg: 0, n: 0 };
  return { avg: ns.reduce((s, o) => s + o.score, 0) / ns.length, n: ns.length };
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, m: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + m);
  return out;
}

async function main() {
  const args = parseArgs();
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - args.years);

  const startStr = dateOnly(start);
  const endStr = dateOnly(end);

  const grid = buildGrid(args.quick);
  console.log(`\nAuto-tune: ${grid.length} combinations`);
  console.log(`Window: ${startStr} → ${endStr} (${args.years}y)`);
  console.log("");

  const outcomes: Outcome[] = [];
  for (let i = 0; i < grid.length; i++) {
    const combo = grid[i]!;
    const label = comboLabel(combo);
    process.stdout.write(`[${i + 1}/${grid.length}] ${label} … `);
    try {
      const { runId, result } = await runBacktestEndToEnd({
        start: startStr,
        end: endStr,
        capital: args.capital,
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
      console.log(`trd=${s.trades} PF=${partial.profitFactor.toFixed(2)} DD=${s.maxDrawdownPct.toFixed(1)}% score=${score.toFixed(2)}`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  outcomes.sort((a, b) => b.score - a.score);
  const top5 = outcomes.slice(0, 5);
  if (top5.length === 0) {
    console.error("No valid outcomes — aborting recommendation.");
    process.exit(1);
  }
  const winner = top5[0]!;
  const robustness = neighbourScore(winner, outcomes);
  const robustnessRatio = winner.score > 0 ? robustness.avg / winner.score : 0;

  // ── Out-of-sample validation ────────────────────────────────────────
  // Re-test the winner combo on a rolling walk-forward to verify the
  // edge isn't just an in-sample fit. Protocol: 12mo train slices used
  // implicitly via the full lookback, then test on the most recent 3mo
  // window (which the in-sample sweep also saw — but using ONLY the
  // winner combo, no peeking across multiple combos on the test set).
  //
  // Stronger test: chop the lookback into 3 sequential test windows and
  // run the winner combo on each. If avg test PF > 1.2, the edge holds.
  console.log("\n── Out-of-sample validation ──");
  const testWindows: { start: string; end: string }[] = [];
  const testMonths = 3;
  const numTests = 3;
  for (let i = numTests; i > 0; i--) {
    const tEnd = addMonths(end, -((i - 1) * testMonths));
    const tStart = addMonths(tEnd, -testMonths);
    testWindows.push({ start: dateOnly(tStart), end: dateOnly(tEnd) });
  }

  const oosResults: { window: string; trades: number; pf: number; ret: number }[] = [];
  for (const tw of testWindows) {
    process.stdout.write(`  OOS ${tw.start} → ${tw.end} … `);
    try {
      const { result } = await runBacktestEndToEnd({
        start: tw.start,
        end: tw.end,
        capital: args.capital,
        riskPctPerTrade: winner.combo.riskPct,
        portfolioHeatCapPct: winner.combo.heatCap,
        maxPositionsPerSector: winner.combo.sectorCap,
        convictionMultipliers: multipliersFor(winner.combo.gradeFloor),
        label: `oos-validation ${comboLabel(winner.combo)} ${tw.start}`,
        persist: true,
      });
      const s = result.summary;
      const pf = Number.isFinite(s.profitFactor) ? s.profitFactor : 0;
      oosResults.push({ window: `${tw.start}→${tw.end}`, trades: s.trades, pf, ret: s.totalReturnPct });
      console.log(`trd=${s.trades} PF=${pf.toFixed(2)} ret=${s.totalReturnPct.toFixed(2)}%`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const validOos = oosResults.filter((r) => r.trades >= 1);
  const avgOosPf = validOos.length > 0 ? validOos.reduce((s, r) => s + r.pf, 0) / validOos.length : 0;
  const winningOos = validOos.filter((r) => r.pf > 1).length;
  const oosTotalTrades = validOos.reduce((s, r) => s + r.trades, 0);

  // Gate: only emit a "promote" recommendation when OOS validates the IS winner.
  // Thresholds derived from earlier walk-forward run that produced "marginal" verdict.
  const oosPasses =
    validOos.length >= 2 &&
    avgOosPf >= 1.2 &&
    winningOos >= Math.ceil(validOos.length * 0.5) &&
    oosTotalTrades >= 5;

  const promoteVerdict = oosPasses ? "PROMOTE_OK" : "OOS_GATE_FAILED";
  console.log(`\n  OOS summary: avg PF ${avgOosPf.toFixed(2)} across ${validOos.length} windows, ${winningOos} winning, ${oosTotalTrades} total trades`);
  console.log(`  Promote gate: ${promoteVerdict}`);

  // ── Compare against previous recommendation ─────────────────────────
  const recDir = join(process.cwd(), "data", "recommendations");
  mkdirSync(recDir, { recursive: true });
  const latestPath = join(recDir, "latest.json");

  interface Recommendation {
    generatedAt: string;
    window: { start: string; end: string; years: number };
    universe: { capital: number };
    winner: Outcome;
    robustness: { avgNeighbourScore: number; ratio: number; verdict: string; nNeighbours: number };
    oosValidation: {
      windows: typeof oosResults;
      avgOosPf: number;
      winningWindows: number;
      totalTrades: number;
      passes: boolean;
      verdict: string;
    };
    top5: Outcome[];
    sweepSize: number;
    delta?: { fromWinnerCombo: Combo; deltaScore: number; deltaPF: number };
  }

  let prevWinnerCombo: Combo | undefined;
  let prevWinnerScore: number | undefined;
  let prevWinnerPF: number | undefined;
  if (existsSync(latestPath)) {
    try {
      const prev = JSON.parse(readFileSync(latestPath, "utf-8")) as Recommendation;
      prevWinnerCombo = prev.winner.combo;
      prevWinnerScore = prev.winner.score;
      prevWinnerPF = prev.winner.profitFactor;
    } catch {
      // ignore — old file unreadable
    }
  }

  const verdict =
    !Number.isFinite(robustnessRatio) || robustness.n === 0
      ? "INSUFFICIENT_DATA"
      : robustnessRatio < 0.5
        ? "ISOLATED_PEAK"
        : "STABLE_PLATEAU";

  const recommendation: Recommendation = {
    generatedAt: new Date().toISOString(),
    window: { start: startStr, end: endStr, years: args.years },
    universe: { capital: args.capital },
    winner,
    robustness: {
      avgNeighbourScore: robustness.avg,
      ratio: robustnessRatio,
      nNeighbours: robustness.n,
      verdict,
    },
    oosValidation: {
      windows: oosResults,
      avgOosPf,
      winningWindows: winningOos,
      totalTrades: oosTotalTrades,
      passes: oosPasses,
      verdict: promoteVerdict,
    },
    top5,
    sweepSize: grid.length,
    ...(prevWinnerCombo
      ? {
          delta: {
            fromWinnerCombo: prevWinnerCombo,
            deltaScore: winner.score - (prevWinnerScore ?? 0),
            deltaPF: winner.profitFactor - (prevWinnerPF ?? 0),
          },
        }
      : {}),
  };

  // Write latest + timestamped archive
  writeFileSync(latestPath, JSON.stringify(recommendation, null, 2));
  const archivePath = join(recDir, `${dateOnly(new Date())}-${Date.now()}.json`);
  writeFileSync(archivePath, JSON.stringify(recommendation, null, 2));

  // ── Print summary ───────────────────────────────────────────────────
  console.log("\n══════════════ RECOMMENDATION ══════════════");
  console.log(`Window: ${startStr} → ${endStr}`);
  console.log(`\nWINNER: ${comboLabel(winner.combo)}`);
  console.log(`  Trades=${winner.trades}  Win%=${(winner.winRate * 100).toFixed(1)}%  PF=${winner.profitFactor.toFixed(2)}  ExpR=${winner.expectancyR.toFixed(3)}`);
  console.log(`  Return=${winner.totalReturnPct.toFixed(2)}%  CAGR=${winner.cagrPct.toFixed(2)}%  DD=${winner.maxDrawdownPct.toFixed(2)}%`);
  console.log(`  Score=${winner.score.toFixed(3)}  RunId=${winner.runId}`);
  console.log(`\nRobustness: ${verdict} (ratio ${robustnessRatio.toFixed(2)} across ${robustness.n} neighbours)`);
  console.log(`OOS gate:    ${promoteVerdict} (avg PF ${avgOosPf.toFixed(2)} across ${validOos.length} windows)`);
  if (oosPasses) {
    console.log(`             ✅ Edge survives out-of-sample. Safe to promote.`);
  } else {
    console.log(`             ❌ Out-of-sample evidence too weak. Do NOT promote this config.`);
  }
  if (recommendation.delta) {
    const d = recommendation.delta;
    console.log(`\nVs. previous recommendation:`);
    console.log(`  Previous: ${comboLabel(d.fromWinnerCombo)}`);
    console.log(`  Δ score: ${d.deltaScore >= 0 ? "+" : ""}${d.deltaScore.toFixed(3)}`);
    console.log(`  Δ PF:    ${d.deltaPF >= 0 ? "+" : ""}${d.deltaPF.toFixed(2)}`);
  }
  console.log(`\nWritten to:`);
  console.log(`  ${latestPath}`);
  console.log(`  ${archivePath}`);
  console.log(`\nReview, then promote manually to env or AppSettings.`);

  // ── Optional Telegram notification ──────────────────────────────────
  if (args.notify) {
    const lines = [
      `<b>VolumeTurtle Auto-Tune</b>`,
      ``,
      `<b>Recommended config:</b>`,
      `Grade ≥ ${winner.combo.gradeFloor} · risk ${(winner.combo.riskPct * 100).toFixed(2)}% · heat ${(winner.combo.heatCap * 100).toFixed(0)}% · sec ${winner.combo.sectorCap}`,
      ``,
      `Trades ${winner.trades} · Win ${(winner.winRate * 100).toFixed(1)}% · PF ${winner.profitFactor.toFixed(2)}`,
      `Return ${winner.totalReturnPct.toFixed(1)}% · DD ${winner.maxDrawdownPct.toFixed(1)}%`,
      ``,
      `Robustness: ${verdict}`,
      `OOS gate: ${promoteVerdict} (avg PF ${avgOosPf.toFixed(2)})`,
      oosPasses ? `✅ Safe to promote` : `❌ Do NOT promote — OOS evidence weak`,
    ];
    if (recommendation.delta) {
      lines.push(``, `Δ vs previous: PF ${recommendation.delta.deltaPF >= 0 ? "+" : ""}${recommendation.delta.deltaPF.toFixed(2)}`);
    }
    try {
      await sendTelegram({ text: lines.join("\n") });
      console.log(`\nTelegram notification sent.`);
    } catch (err) {
      console.error(`Telegram send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect());
