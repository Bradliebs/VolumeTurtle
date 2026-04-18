"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { mono, fmtMoney } from "../components/helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface BacktestRunSummary {
  id: number;
  label: string | null;
  startedAt: string;
  completedAt: string | null;
  startDate: string;
  endDate: string;
  initialCapital: number;
  engine: string;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  expectancyR: number | null;
  totalReturnPct: number | null;
  cagrPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownPct: number | null;
  finalEquity: number | null;
  actualStartDate: string | null;
  actualEndDate: string | null;
  actualYears: number | null;
  blockedByHeatCap: number | null;
  blockedBySectorCap: number | null;
  portfolioHeatCapPct: number | null;
  maxPositionsPerSector: number | null;
  status: string;
  error: string | null;
}

interface SnapshotInfo {
  date: string;
  tickerCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function defaultStartDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10);
}
function defaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtPct(n: number | null, decimals = 2): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(decimals)}%`;
}
function fmtNum(n: number | null, decimals = 2): string {
  if (n === null) return "—";
  if (!Number.isFinite(n)) return "∞";
  return n.toFixed(decimals);
}
function gradeColor(metric: string, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "text-[var(--dim)]";
  if (metric === "sharpe") {
    if (value >= 1.2) return "text-[var(--green)]";
    if (value >= 0.7) return "text-[var(--amber)]";
    return "text-[var(--red)]";
  }
  if (metric === "profitFactor") {
    if (value >= 2.0) return "text-[var(--green)]";
    if (value >= 1.5) return "text-[var(--amber)]";
    return "text-[var(--red)]";
  }
  if (metric === "expectancyR") {
    if (value >= 0.5) return "text-[var(--green)]";
    if (value >= 0.3) return "text-[var(--amber)]";
    return "text-[var(--red)]";
  }
  if (metric === "maxDD") {
    if (value < 15) return "text-[var(--green)]";
    if (value < 25) return "text-[var(--amber)]";
    return "text-[var(--red)]";
  }
  return "text-white";
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function BacktestPage() {
  const [runs, setRuns] = useState<BacktestRunSummary[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [start, setStart] = useState(defaultStartDate());
  const [end, setEnd] = useState(defaultEndDate());
  const [capital, setCapital] = useState(10000);
  const [riskPct, setRiskPct] = useState(2.0);
  const [maxOpen, setMaxOpen] = useState(5);
  const [slippageBps, setSlippageBps] = useState(5);
  const [spreadBps, setSpreadBps] = useState(15);
  const [useSnapshots, setUseSnapshots] = useState(false);
  const [label, setLabel] = useState("");

  // Tier-2 risk controls — defaults intentionally NEUTRAL (no behaviour change
  // unless the user enables the toggle). Lets users A/B vs the baseline.
  const [useConviction, setUseConviction] = useState(false);
  const [convA, setConvA] = useState(1.5);
  const [convB, setConvB] = useState(1.2);
  const [convC, setConvC] = useState(1.0);
  const [convD, setConvD] = useState(0.6);
  const [useHeatCap, setUseHeatCap] = useState(false);
  const [heatCapPct, setHeatCapPct] = useState(8.0); // % of equity
  const [useSectorCap, setUseSectorCap] = useState(false);
  const [maxPerSector, setMaxPerSector] = useState(2);

  const refresh = useCallback(async () => {
    try {
      const [runsRes, snapsRes] = await Promise.all([
        fetch("/api/backtest"),
        fetch("/api/backtest/snapshot"),
      ]);
      if (runsRes.ok) {
        const d = await runsRes.json();
        setRuns(d.runs ?? []);
      }
      if (snapsRes.ok) {
        const d = await snapsRes.json();
        setSnapshots(d.snapshots ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runBacktest = async () => {
    setRunning(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start,
          end,
          capital,
          riskPctPerTrade: riskPct / 100,
          maxOpenPositions: maxOpen,
          slippageBps,
          spreadBps,
          useSnapshots,
          label: label || undefined,
          ...(useConviction ? { convictionMultipliers: { A: convA, B: convB, C: convC, D: convD } } : {}),
          ...(useHeatCap ? { portfolioHeatCapPct: heatCapPct / 100 } : {}),
          ...(useSectorCap ? { maxPositionsPerSector: maxPerSector } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Backtest failed");
      } else {
        setSuccess(
          `Backtest #${data.runId} complete in ${(data.elapsedMs / 1000).toFixed(1)}s — ` +
            `${data.summary.trades} trades, Sharpe ${data.summary.sharpe.toFixed(2)}, ` +
            `Total return ${data.summary.totalReturnPct.toFixed(2)}%`,
        );
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const snapshotNow = async () => {
    setSnapshotting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/backtest/snapshot", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Snapshot failed");
      } else {
        setSuccess(`Captured ${data.tickerCount} tickers for ${data.date}`);
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSnapshotting(false);
    }
  };

  const deleteRun = async (id: number) => {
    if (!confirm(`Delete backtest #${id}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/backtest/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Delete failed");
      } else {
        await refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="min-h-screen bg-[var(--bg)] text-white p-6" style={mono}>
      {/* HEADER */}
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] pb-3 mb-6">
        <h1 className="text-xl font-bold tracking-tight mr-2 text-[var(--green)]">VolumeTurtle</h1>
        <nav className="flex items-center gap-4 text-sm mr-2">
          <Link href="/" className="text-[var(--dim)] hover:text-white transition-colors">DASHBOARD</Link>
          <Link href="/journal" className="text-[var(--dim)] hover:text-white transition-colors">JOURNAL</Link>
          <Link href="/momentum" className="text-[var(--dim)] hover:text-white transition-colors">MOMENTUM</Link>
          <Link href="/watchlist" className="text-[var(--dim)] hover:text-white transition-colors">WATCHLIST</Link>
          <Link href="/execution" className="text-[var(--amber)] hover:text-white transition-colors">PENDING</Link>
          <span className="text-white font-semibold border-b-2 border-[var(--green)] pb-0.5">BACKTEST</span>
          <Link href="/settings" className="text-[var(--dim)] hover:text-white transition-colors">SETTINGS</Link>
        </nav>
      </header>

      {/* MESSAGES */}
      {error && (
        <div className="mb-4 border border-[var(--red)] bg-[#1a0000] p-3 text-sm text-[var(--red)] flex justify-between items-start">
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} className="text-[var(--dim)] hover:text-white ml-4">✕</button>
        </div>
      )}
      {success && (
        <div className="mb-4 border border-[var(--green)] bg-[#001a00] p-3 text-sm text-[var(--green)] flex justify-between items-start">
          <span>✓ {success}</span>
          <button onClick={() => setSuccess(null)} className="text-[var(--dim)] hover:text-white ml-4">✕</button>
        </div>
      )}

      {/* UNIVERSE SNAPSHOT PANEL */}
      <section className="mb-6 border border-[var(--border)] bg-[var(--card)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold tracking-widest text-[var(--dim)]">UNIVERSE SNAPSHOTS</h2>
          <button
            onClick={snapshotNow}
            disabled={snapshotting}
            className="text-xs border border-[var(--green)] text-[var(--green)] px-3 py-1 hover:bg-[var(--green)]/10 disabled:opacity-50"
          >
            {snapshotting ? "CAPTURING..." : "+ SNAPSHOT NOW"}
          </button>
        </div>
        <p className="text-xs text-[var(--dim)] mb-3">
          Point-in-time universe captures eliminate survivorship bias in backtests.
          Capture weekly (or schedule it) to build history.
        </p>
        {snapshots.length === 0 ? (
          <p className="text-sm text-[var(--amber)]">No snapshots yet. Click SNAPSHOT NOW to seed your first one.</p>
        ) : (
          <div className="text-xs text-[var(--dim)]">
            <span>{snapshots.length} snapshots — most recent: </span>
            <span className="text-white">{snapshots[0]?.date} ({snapshots[0]?.tickerCount} tickers)</span>
          </div>
        )}
      </section>

      {/* RUN BACKTEST FORM */}
      <section className="mb-6 border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-xs font-semibold tracking-widest text-[var(--dim)] mb-3">RUN BACKTEST</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-[var(--dim)]">Start date</span>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--dim)]">End date</span>
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--dim)]">Initial capital (£)</span>
            <input
              type="number"
              min="1"
              step="100"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--dim)]">Risk % per trade</span>
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={riskPct}
              onChange={(e) => setRiskPct(Number(e.target.value))}
              className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--dim)]">Max open positions</span>
            <input
              type="number"
              min="1"
              max="50"
              step="1"
              value={maxOpen}
              onChange={(e) => setMaxOpen(Number(e.target.value))}
              className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--dim)]">Slippage (bps)</span>
            <input
              type="number"
              min="0"
              max="100"
              step="1"
              value={slippageBps}
              onChange={(e) => setSlippageBps(Number(e.target.value))}
              className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--dim)]">Half-spread (bps)</span>
            <input
              type="number"
              min="0"
              max="200"
              step="1"
              value={spreadBps}
              onChange={(e) => setSpreadBps(Number(e.target.value))}
              className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[var(--dim)]">Label (optional)</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. baseline-default-costs"
              className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-[var(--dim)]">
            <input
              type="checkbox"
              checked={useSnapshots}
              onChange={(e) => setUseSnapshots(e.target.checked)}
              disabled={snapshots.length === 0}
            />
            <span>Use universe snapshot (avoids survivorship bias){snapshots.length === 0 ? " — no snapshots available" : ""}</span>
          </label>
          <button
            onClick={runBacktest}
            disabled={running}
            className="ml-auto text-sm border border-[var(--green)] text-[var(--green)] px-4 py-1.5 hover:bg-[var(--green)]/10 disabled:opacity-50"
          >
            {running ? "RUNNING..." : "▶ RUN BACKTEST"}
          </button>
        </div>

        {/* TIER-2 RISK CONTROLS */}
        <div className="mt-5 pt-4 border-t border-[var(--border)]">
          <h3 className="text-[10px] font-semibold tracking-widest text-[var(--dim)] mb-3">RISK CONTROLS (TIER 2)</h3>

          {/* Conviction sizing */}
          <div className="mb-3">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={useConviction} onChange={(e) => setUseConviction(e.target.checked)} />
              <span className="text-white">Conviction-weighted sizing</span>
              <span className="text-[var(--dim)]">— scale risk by composite-score grade</span>
            </label>
            {useConviction && (
              <div className="mt-2 ml-6 grid grid-cols-4 gap-3 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--green)]">A grade ×</span>
                  <input type="number" min="0" max="3" step="0.1" value={convA} onChange={(e) => setConvA(Number(e.target.value))} className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--green)]">B grade ×</span>
                  <input type="number" min="0" max="3" step="0.1" value={convB} onChange={(e) => setConvB(Number(e.target.value))} className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--amber)]">C grade ×</span>
                  <input type="number" min="0" max="3" step="0.1" value={convC} onChange={(e) => setConvC(Number(e.target.value))} className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[var(--red)]">D grade ×</span>
                  <input type="number" min="0" max="3" step="0.1" value={convD} onChange={(e) => setConvD(Number(e.target.value))} className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white" />
                </label>
              </div>
            )}
          </div>

          {/* Heat cap */}
          <div className="mb-3">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={useHeatCap} onChange={(e) => setUseHeatCap(e.target.checked)} />
              <span className="text-white">Portfolio heat cap</span>
              <span className="text-[var(--dim)]">— hard ceiling on total open risk</span>
            </label>
            {useHeatCap && (
              <div className="mt-2 ml-6 text-xs flex items-center gap-2">
                <span className="text-[var(--dim)]">Max total open risk:</span>
                <input type="number" min="1" max="50" step="0.5" value={heatCapPct} onChange={(e) => setHeatCapPct(Number(e.target.value))} title="Portfolio heat cap percentage" className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white w-20" />
                <span className="text-[var(--dim)]">% of equity</span>
              </div>
            )}
          </div>

          {/* Sector cap */}
          <div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={useSectorCap} onChange={(e) => setUseSectorCap(e.target.checked)} />
              <span className="text-white">Sector concentration cap</span>
              <span className="text-[var(--dim)]">— max simultaneous positions per sector</span>
            </label>
            {useSectorCap && (
              <div className="mt-2 ml-6 text-xs flex items-center gap-2">
                <span className="text-[var(--dim)]">Max positions per sector:</span>
                <input type="number" min="1" max="10" step="1" value={maxPerSector} onChange={(e) => setMaxPerSector(Number(e.target.value))} title="Max positions per sector" className="bg-[var(--bg)] border border-[var(--border)] px-2 py-1 text-white w-20" />
              </div>
            )}
          </div>
        </div>
        {running && (
          <p className="mt-2 text-xs text-[var(--amber)]">
            Backtests typically take 5–30 seconds. Don&apos;t close this page.
          </p>
        )}
      </section>

      {/* RESULTS TABLE */}
      <section className="mb-6 border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-xs font-semibold tracking-widest text-[var(--dim)] mb-3">BACKTEST HISTORY</h2>
        {loading ? (
          <p className="text-sm text-[var(--dim)]">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-[var(--dim)]">No backtests yet. Run your first one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[var(--dim)] border-b border-[var(--border)]">
                  <th className="text-left py-2 pr-3">ID</th>
                  <th className="text-left py-2 pr-3">Label</th>
                  <th className="text-left py-2 pr-3">Window</th>
                  <th className="text-right py-2 pr-3">Trades</th>
                  <th className="text-right py-2 pr-3">Win %</th>
                  <th className="text-right py-2 pr-3">PF</th>
                  <th className="text-right py-2 pr-3">Exp R</th>
                  <th className="text-right py-2 pr-3">Return</th>
                  <th className="text-right py-2 pr-3">CAGR</th>
                  <th className="text-right py-2 pr-3">Sharpe</th>
                  <th className="text-right py-2 pr-3">Max DD</th>
                  <th className="text-right py-2 pr-3">Final</th>
                  <th className="text-right py-2 pr-3">Status</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  // Detect silent clamp: actual covered window is materially
                  // narrower than what the user requested. >7d gap means the
                  // historical quote cache didn't cover the full window, and
                  // CAGR is annualised from a shorter slice — flag it.
                  const requestedDays = (new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / 86_400_000;
                  const actualDays = r.actualStartDate && r.actualEndDate
                    ? (new Date(r.actualEndDate).getTime() - new Date(r.actualStartDate).getTime()) / 86_400_000
                    : requestedDays;
                  const clamped = requestedDays - actualDays > 7;
                  const clampPct = requestedDays > 0 ? Math.round((1 - actualDays / requestedDays) * 100) : 0;
                  return (
                  <tr key={r.id} className="border-b border-[var(--border)]/40 hover:bg-white/5">
                    <td className="py-2 pr-3 text-[var(--dim)]">#{r.id}</td>
                    <td className="py-2 pr-3 text-white">
                      {r.label ?? "\u2014"}
                      {(r.portfolioHeatCapPct !== null || r.maxPositionsPerSector !== null || r.blockedByHeatCap || r.blockedBySectorCap) && (
                        <div className="text-[9px] text-[var(--dim)] mt-0.5 flex flex-wrap gap-1">
                          {r.portfolioHeatCapPct !== null && (
                            <span title={`Heat cap: ${(r.portfolioHeatCapPct * 100).toFixed(1)}% open risk max${r.blockedByHeatCap ? ` — blocked ${r.blockedByHeatCap} entries` : ""}`}
                              className="px-1 rounded bg-[var(--green)]/10 text-[var(--green)] border border-[var(--green)]/30">
                              heat {(r.portfolioHeatCapPct * 100).toFixed(0)}%
                              {r.blockedByHeatCap ? ` (\u00d7${r.blockedByHeatCap})` : ""}
                            </span>
                          )}
                          {r.maxPositionsPerSector !== null && (
                            <span title={`Sector cap: max ${r.maxPositionsPerSector} per sector${r.blockedBySectorCap ? ` — blocked ${r.blockedBySectorCap} entries` : ""}`}
                              className="px-1 rounded bg-[var(--green)]/10 text-[var(--green)] border border-[var(--green)]/30">
                              sector \u2264{r.maxPositionsPerSector}
                              {r.blockedBySectorCap ? ` (\u00d7${r.blockedBySectorCap})` : ""}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[var(--dim)]">
                      {r.startDate} → {r.endDate}
                      {clamped && (
                        <span
                          className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-[var(--amber)]/20 text-[var(--amber)] border border-[var(--amber)]/40"
                          title={`Only ${r.actualStartDate} → ${r.actualEndDate} of historical data was available (${clampPct}% of requested window missing). CAGR is annualised from the shorter slice — run "npm run backfill:quotes" to load full history.`}
                        >
                          ⚠ clamped {actualDays.toFixed(0)}d
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right text-white">{r.trades}</td>
                    <td className="py-2 pr-3 text-right text-white">{r.winRate !== null ? `${(r.winRate * 100).toFixed(1)}%` : "—"}</td>
                    <td className={`py-2 pr-3 text-right ${gradeColor("profitFactor", r.profitFactor)}`}>{fmtNum(r.profitFactor)}</td>
                    <td className={`py-2 pr-3 text-right ${gradeColor("expectancyR", r.expectancyR)}`}>{fmtNum(r.expectancyR, 3)}</td>
                    <td className={`py-2 pr-3 text-right ${(r.totalReturnPct ?? 0) >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{fmtPct(r.totalReturnPct)}</td>
                    <td className={`py-2 pr-3 text-right ${(r.cagrPct ?? 0) >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{fmtPct(r.cagrPct)}</td>
                    <td className={`py-2 pr-3 text-right ${gradeColor("sharpe", r.sharpe)}`}>{fmtNum(r.sharpe)}</td>
                    <td className={`py-2 pr-3 text-right ${gradeColor("maxDD", r.maxDrawdownPct)}`}>{fmtPct(r.maxDrawdownPct)}</td>
                    <td className="py-2 pr-3 text-right text-white">{r.finalEquity !== null ? fmtMoney(r.finalEquity) : "—"}</td>
                    <td className="py-2 pr-3 text-right">
                      <span className={r.status === "COMPLETED" ? "text-[var(--green)]" : r.status === "FAILED" ? "text-[var(--red)]" : "text-[var(--amber)]"}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => deleteRun(r.id)}
                        className="text-[var(--dim)] hover:text-[var(--red)] text-xs"
                        title="Delete"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {runs.length > 0 && (
          <div className="mt-3 text-[10px] text-[var(--dim)] flex flex-wrap gap-x-4 gap-y-1">
            <span>Sharpe colour: <span className="text-[var(--green)]">≥1.2</span> · <span className="text-[var(--amber)]">≥0.7</span> · <span className="text-[var(--red)]">&lt;0.7</span></span>
            <span>PF: <span className="text-[var(--green)]">≥2.0</span> · <span className="text-[var(--amber)]">≥1.5</span> · <span className="text-[var(--red)]">&lt;1.5</span></span>
            <span>Exp R: <span className="text-[var(--green)]">≥0.5</span> · <span className="text-[var(--amber)]">≥0.3</span> · <span className="text-[var(--red)]">&lt;0.3</span></span>
            <span>Max DD: <span className="text-[var(--green)]">&lt;15%</span> · <span className="text-[var(--amber)]">&lt;25%</span> · <span className="text-[var(--red)]">≥25%</span></span>
          </div>
        )}
      </section>
    </main>
  );
}
