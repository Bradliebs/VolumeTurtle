"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccountSnapshot {
  id: string;
  date: string;
  balance: number;
  openTrades: number;
}

interface Trade {
  id: string;
  ticker: string;
  entryDate: string;
  entryPrice: number;
  shares: number;
  hardStop: number;
  trailingStop: number;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: string | null;
  rMultiple: number | null;
  status: string;
  volumeRatio: number;
  rangePosition: number;
  atr20: number;
}

interface ScanResult {
  id: string;
  scanDate: string;
  ticker: string;
  signalFired: boolean;
  volumeRatio: number | null;
  rangePosition: number | null;
  atr20: number | null;
  actionTaken: string | null;
}

interface StopHistoryEntry {
  id: string;
  date: string;
  stopLevel: number;
  stopType: string;
  changed: boolean;
  changeAmount: number | null;
}

interface ActionItem {
  type: string;
  ticker: string;
  message: string;
  urgency: string;
  stopHistoryId?: string;
}

interface Instruction {
  ticker: string;
  currency: string;
  type: "HOLD" | "UPDATE_STOP" | "EXIT";
  currentStop: number;
  stopSetDate: string | null;
  latestClose: number | null;
  oldStop: number | null;
  newStop: number | null;
  changeAmount: number | null;
  breakAmount: number | null;
  actioned: boolean;
}

interface TradeWithHistory extends Trade {
  stopHistory: StopHistoryEntry[];
}

interface DashboardData {
  account: AccountSnapshot | null;
  openTrades: TradeWithHistory[];
  recentSignals: ScanResult[];
  closedTrades: Trade[];
  lastScanTime: string | null;
  actions: ActionItem[];
  instructions: Instruction[];
}

interface SignalFired {
  ticker: string;
  currency: string;
  date: string;
  close: number;
  volume: number;
  avgVolume20: number;
  volumeRatio: number;
  rangePosition: number;
  atr20: number;
  suggestedEntry: number;
  hardStop: number;
  riskPerShare: number;
  positionSize: {
    shares: number;
    totalExposure: number;
    dollarRisk: number;
    exposurePercent: number;
    exposureWarning: string | null;
  } | null;
}

interface NearMiss {
  ticker: string;
  volumeRatio: number;
  rangePosition: number;
  failedOn: "VOLUME" | "RANGE" | "LIQUIDITY";
}

interface ScanResponse {
  date: string;
  dryRun: boolean;
  summary: { signalCount: number; entered: number; exited: number };
  signalsFired: SignalFired[];
  tradesEntered: { ticker: string; shares: number; suggestedEntry: number; hardStop: number }[];
  tradesExited: { ticker: string; exitPrice: number; rMultiple: number }[];
  nearMisses: NearMiss[];
  openPositions: number;
  balance: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mono = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

function fmtMoney(n: number): string {
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPrice(n: number, currency = "£"): string {
  return currency + n.toFixed(2);
}

/** Currency symbol for a ticker based on exchange suffix */
function tickerCurrency(ticker: string): string {
  if (ticker.endsWith(".L")) return "£";
  if (ticker.endsWith(".AS") || ticker.endsWith(".HE")) return "€";
  if (ticker.endsWith(".ST") || ticker.endsWith(".CO")) return "kr";
  return "$";
}

function fmtTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function pctChange(from: number, to: number): string {
  if (from === 0) return "0.0%";
  return ((to - from) / from * 100).toFixed(1) + "%";
}

// ---------------------------------------------------------------------------
// Mini bar
// ---------------------------------------------------------------------------

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-[#222] rounded overflow-hidden">
        <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton rows
// ---------------------------------------------------------------------------

function SkeletonRows({ cols, rows = 3 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-3 py-2">
              <div className="h-4 rounded bg-[#222] animate-skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-block px-2 py-0.5 text-xs font-medium rounded border"
      style={{ color, borderColor: color, ...mono }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Confirmation Modal
// ---------------------------------------------------------------------------

function ConfirmModal({
  balance,
  remaining,
  onConfirm,
  onCancel,
}: {
  balance: number;
  remaining: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="border border-[#333] bg-[#111] p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold text-[var(--amber)] mb-4">⚠ LIVE SCAN</h3>
        <p className="text-sm text-[var(--dim)] mb-1">This will write trades to the database.</p>
        <p className="text-sm text-[var(--dim)] mb-1">
          Current balance: <span className="text-white" style={mono}>{fmtMoney(balance)}</span>
        </p>
        <p className="text-sm text-[var(--dim)] mb-6">
          Max new positions: <span className="text-white" style={mono}>{remaining}</span> remaining
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-[#333] text-[var(--dim)] hover:text-white transition-colors"
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-black transition-colors font-semibold"
          >
            CONFIRM — RUN LIVE SCAN
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signal Card
// ---------------------------------------------------------------------------

function SignalCard({
  signal,
  dryRun,
  onMarkPlaced,
  placing,
}: {
  signal: SignalFired;
  dryRun: boolean;
  onMarkPlaced: (signal: SignalFired) => void;
  placing: boolean;
}) {
  const stopPct = pctChange(signal.suggestedEntry, signal.hardStop);
  const pos = signal.positionSize;
  const c = signal.currency ?? tickerCurrency(signal.ticker);
  return (
    <div className="border border-[var(--green)] bg-[#111] p-4 mb-3">
      <p className="text-lg font-bold text-[var(--green)] mb-3" style={mono}>
        🟢 SIGNAL — {signal.ticker}
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3" style={mono}>
        <span className="text-[var(--dim)]">Entry</span>
        <span>{fmtPrice(signal.suggestedEntry, c)}</span>
        <span className="text-[var(--dim)]">Hard stop</span>
        <span className="text-[var(--red)]">{fmtPrice(signal.hardStop, c)} ({stopPct})</span>
        <span className="text-[var(--dim)]">Risk/share</span>
        <span>{fmtPrice(signal.riskPerShare, c)}</span>
        {pos && (
          <>
            <span className="text-[var(--dim)]">Shares</span>
            <span>
              {pos.shares >= 1 ? pos.shares : pos.shares.toFixed(4)}
              {pos.shares < 1 && (
                <span className="text-[var(--dim)] ml-1">(fractional)</span>
              )}
            </span>
            {pos.shares < 1 && (
              <>
                <span />
                <span className="text-[var(--dim)] text-[10px]">Trading 212 fractional order</span>
              </>
            )}
            <span className="text-[var(--dim)]">Total exposure</span>
            <span>{fmtPrice(pos.totalExposure, c)} ({(pos.exposurePercent * 100).toFixed(1)}%)</span>
            {pos.exposureWarning && (
              <>
                <span />
                <span className="text-[var(--amber)] text-[10px]">⚠ {pos.exposureWarning}</span>
              </>
            )}
            <span className="text-[var(--dim)]">Risk</span>
            <span className="text-[var(--red)]">{fmtPrice(pos.dollarRisk, c)} (2.0%)</span>
          </>
        )}
        <span className="text-[var(--dim)]">ATR20</span>
        <span>{fmtPrice(signal.atr20, c)}</span>
      </div>
      <div className="flex items-center gap-3 text-xs mb-3" style={mono}>
        <span className="text-[var(--dim)]">Volume ratio</span>
        <span className="text-[var(--green)]">{signal.volumeRatio.toFixed(1)}x</span>
        <MiniBar value={signal.volumeRatio} max={3} color="var(--green)" />
      </div>
      <div className="flex items-center gap-3 text-xs mb-4" style={mono}>
        <span className="text-[var(--dim)]">Range position</span>
        <span className="text-[var(--green)]">{(signal.rangePosition * 100).toFixed(0)}%</span>
        <MiniBar value={signal.rangePosition} max={1} color="var(--green)" />
      </div>
      <button
        onClick={() => onMarkPlaced(signal)}
        disabled={dryRun || placing || !pos}
        className={`w-full px-4 py-2 text-xs border font-semibold transition-colors ${
          dryRun
            ? "border-[#333] text-[#555] cursor-not-allowed"
            : "border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black"
        }`}
        style={mono}
      >
        {placing ? "SAVING…" : dryRun ? "DRY RUN — not written" : "MARK AS PLACED"}
      </button>
    </div>
  );
}

interface T212PositionData {
  currentPrice: number;
  quantity: number;
  averagePrice: number;
  ppl: number;
  stopLoss: number | null;
  confirmed: boolean;
}

interface SyncResult {
  tradeId: string;
  ticker: string;
  trade?: TradeWithHistory;
  latestClose?: number;
  latestCloseDate?: string;
  syncedAt?: string;
  stopChanged?: boolean;
  previousStop?: number;
  instruction?: { type: string; message: string; urgent: boolean };
  t212?: T212PositionData | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function Home() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanRunning, setScanRunning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [placingTicker, setPlacingTicker] = useState<string | null>(null);
  const [exitingTradeId, setExitingTradeId] = useState<string | null>(null);
  const [exitPrice, setExitPrice] = useState("");
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [syncingTradeId, setSyncingTradeId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncProgress, setSyncProgress] = useState("");
  const [syncData, setSyncData] = useState<Record<string, SyncResult>>({});
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [exitFlash, setExitFlash] = useState(false);

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await fetch("/api/dashboard");
      if (res.ok) {
        setData(await res.json());
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(() => fetchDashboard(true), 60_000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // Auto-sync on load if positions exist and last sync > 1 hour ago
  useEffect(() => {
    if (!data || data.openTrades.length === 0) return;
    if (lastSyncAt) {
      const elapsed = Date.now() - new Date(lastSyncAt).getTime();
      if (elapsed < 3600_000) return; // Less than 1 hour
    }
    // Only auto-sync once
    if (syncingAll) return;
    syncAllPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.openTrades.length]);

  async function syncPosition(tradeId: string) {
    setSyncingTradeId(tradeId);
    try {
      const res = await fetch(`/api/positions/${tradeId}/sync`, { method: "POST" });
      if (res.ok) {
        const result: SyncResult = await res.json();
        result.tradeId = tradeId;
        setSyncData((prev) => ({ ...prev, [tradeId]: result }));
        setLastSyncAt(new Date().toISOString());
        // Check for exit — flash and scroll
        if (result.instruction?.type === "EXIT") {
          setExitFlash(true);
          setTimeout(() => setExitFlash(false), 1500);
          document.getElementById("daily-instructions")?.scrollIntoView({ behavior: "smooth" });
        }
        fetchDashboard(true);
      }
    } catch {
      // silent
    } finally {
      setSyncingTradeId(null);
    }
  }

  async function syncAllPositions() {
    setSyncingAll(true);
    setSyncProgress("Syncing...");
    try {
      const res = await fetch("/api/positions/sync-all", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        const results: SyncResult[] = json.results ?? [];
        const newSyncData: Record<string, SyncResult> = {};
        let hasExit = false;
        for (const r of results) {
          newSyncData[r.tradeId] = r;
          if (r.instruction?.type === "EXIT") hasExit = true;
        }
        setSyncData((prev) => ({ ...prev, ...newSyncData }));
        setLastSyncAt(json.syncedAt ?? new Date().toISOString());
        if (hasExit) {
          setExitFlash(true);
          setTimeout(() => setExitFlash(false), 1500);
          document.getElementById("daily-instructions")?.scrollIntoView({ behavior: "smooth" });
        }
        fetchDashboard(true);
      }
    } catch {
      // silent
    } finally {
      setSyncingAll(false);
      setSyncProgress("");
    }
  }

  async function runScan(dry: boolean) {
    setScanRunning(true);
    setScanResult(null);
    setScanError(null);
    try {
      const res = await fetch(`/api/scan?dry=${dry}`);
      const json = await res.json();
      if (json.error) {
        setScanError(json.error);
      } else {
        setScanResult(json);
        fetchDashboard(true);
      }
    } catch (err) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanRunning(false);
    }
  }

  async function markPlaced(signal: SignalFired) {
    setPlacingTicker(signal.ticker);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: signal.ticker,
          suggestedEntry: signal.suggestedEntry,
          hardStop: signal.hardStop,
          riskPerShare: signal.riskPerShare,
          volumeRatio: signal.volumeRatio,
          rangePosition: signal.rangePosition,
          atr20: signal.atr20,
          shares: signal.positionSize?.shares ?? 0,
        }),
      });
      if (res.ok) {
        fetchDashboard(true);
      }
    } catch {
      // silent
    } finally {
      setPlacingTicker(null);
    }
  }

  async function markExited(tradeId: string) {
    const price = parseFloat(exitPrice);
    if (isNaN(price) || price <= 0) return;
    try {
      const res = await fetch(`/api/trades/${tradeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exitPrice: price }),
      });
      if (res.ok) {
        setExitingTradeId(null);
        setExitPrice("");
        fetchDashboard(true);
      }
    } catch {
      // silent
    }
  }

  async function updateBalance() {
    const newBal = parseFloat(balanceInput);
    if (isNaN(newBal) || newBal <= 0) return;
    try {
      const res = await fetch("/api/balance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: newBal }),
      });
      if (res.ok) {
        setEditingBalance(false);
        setBalanceInput("");
        fetchDashboard(true);
      }
    } catch {
      // silent
    }
  }

  async function markActionDone(stopHistoryId: string) {
    try {
      const res = await fetch(`/api/stops/${stopHistoryId}`, {
        method: "PATCH",
      });
      if (res.ok) {
        fetchDashboard(true);
      }
    } catch {
      // silent
    }
  }

  // Derived stats
  const account = data?.account;
  const openTrades = data?.openTrades ?? [];
  const recentSignals = data?.recentSignals ?? [];
  const closedTrades = data?.closedTrades ?? [];
  const balance = account?.balance ?? 0;
  const openCount = openTrades.length;
  const totalExposure = openTrades.reduce((s, t) => s + t.entryPrice * t.shares, 0);
  const exposurePct = balance > 0 ? ((totalExposure / balance) * 100).toFixed(1) : "0.0";

  const wins = closedTrades.filter((t) => (t.rMultiple ?? 0) > 0).length;
  const winRate = closedTrades.length > 0 ? ((wins / closedTrades.length) * 100).toFixed(0) : "—";
  const avgR =
    closedTrades.length > 0
      ? (closedTrades.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / closedTrades.length).toFixed(2)
      : "—";

  // Action required items — from server
  const serverActions = data?.actions ?? [];
  const instructions = data?.instructions ?? [];

  // Add new signal actions from client-side scan result
  const actionItems = [...serverActions];
  if (scanResult && !scanResult.dryRun) {
    for (const s of scanResult.signalsFired) {
      const alreadyPlaced = openTrades.some((t) => t.ticker === s.ticker);
      if (!alreadyPlaced) {
        actionItems.push({
          type: "NEW_SIGNAL",
          ticker: s.ticker,
          message: `New signal — ${s.ticker} — see scan panel`,
          urgency: "MEDIUM",
        });
      }
    }
  }

  return (
    <main className="min-h-screen p-4 max-w-[1400px] mx-auto">
      {/* ── HEADER ── */}
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] pb-3 mb-6">
        <h1 className="text-xl font-bold tracking-tight mr-2 text-[var(--green)]" style={mono}>
          VolumeTurtle
        </h1>
        <nav className="flex items-center gap-4 text-sm mr-2" style={mono}>
          <span className="text-white font-semibold border-b-2 border-[var(--green)] pb-0.5">DASHBOARD</span>
          <Link href="/settings" className="text-[var(--dim)] hover:text-white transition-colors">SETTINGS</Link>
        </nav>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--green)]">
          <span className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse-live" />
          LIVE
        </span>
        <span className="text-[var(--border)]">|</span>
        <span className="text-sm text-[var(--dim)]">
          Balance:{" "}
          {editingBalance ? (
            <span className="inline-flex items-center gap-1">
              <span>£</span>
              <input
                type="number"
                step="1"
                value={balanceInput}
                onChange={(e) => setBalanceInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") updateBalance(); if (e.key === "Escape") setEditingBalance(false); }}
                autoFocus
                className="w-24 px-1 py-0.5 text-xs bg-[#0a0a0a] border border-[var(--amber)] text-white"
                style={mono}
              />
              <button
                onClick={updateBalance}
                className="px-1.5 py-0.5 text-xs border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors"
                style={mono}
              >
                ✓
              </button>
              <button
                onClick={() => { setEditingBalance(false); setBalanceInput(""); }}
                className="px-1 py-0.5 text-xs text-[var(--dim)]"
              >
                ✕
              </button>
            </span>
          ) : (
            <span
              className="text-white cursor-pointer hover:text-[var(--amber)] transition-colors"
              style={mono}
              onClick={() => { setEditingBalance(true); setBalanceInput(String(balance)); }}
              title="Click to edit balance"
            >
              {fmtMoney(balance)}
            </span>
          )}
        </span>
        <span className="text-[var(--border)]">|</span>
        <span className="text-sm text-[var(--dim)]">
          Open: <span className="text-white" style={mono}>{openCount}/5</span>
        </span>
        <span className="text-[var(--border)]">|</span>
        <span className="text-sm text-[var(--dim)]">
          Exposure: <span className="text-white" style={mono}>{exposurePct}%</span>
        </span>
        <span className="text-[var(--border)]">|</span>
        <span className="text-sm text-[var(--dim)]">
          Last scan: <span className="text-white" style={mono}>{fmtTime(data?.lastScanTime ?? null)}</span>
        </span>
        {syncingAll && <span className="text-xs text-[var(--amber)] ml-auto">↻ Refreshing positions…</span>}
        {!syncingAll && openCount > 0 && (
          <button
            onClick={syncAllPositions}
            disabled={syncingAll}
            className="ml-auto px-3 py-1 text-xs border border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[var(--amber)] transition-colors"
            style={mono}
          >
            ↻ SYNC ALL
          </button>
        )}
        {refreshing && !syncingAll && <span className="text-xs text-[var(--dim)]">Refreshing…</span>}
      </header>

      {/* ── ACTION REQUIRED ── */}
      {actionItems.length > 0 && (
        <section className="mb-6 border border-[var(--amber)] p-4" style={{ background: "#1a1400" }}>
          <h2 className="text-sm font-semibold text-[var(--amber)] mb-2 tracking-widest">
            ⚠ ACTION REQUIRED — {actionItems.length} item{actionItems.length > 1 ? "s" : ""}
          </h2>
          <div className="space-y-2 text-xs" style={mono}>
            {actionItems.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="mr-1">{a.type === "EXIT" ? "🔴" : "🟡"}</span>
                <span className={`font-semibold ${a.type === "EXIT" ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>
                  {a.type === "EXIT" ? "EXIT" : a.type === "STOP_UPDATE" ? "STOP" : "SIGNAL"}
                </span>
                <span className={`font-semibold ${a.type === "EXIT" ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>
                  {a.ticker}
                </span>
                <span className="text-[var(--dim)] flex-1">{a.message}</span>
                {a.type === "STOP_UPDATE" && a.stopHistoryId && (
                  <button
                    onClick={() => markActionDone(a.stopHistoryId!)}
                    className="px-2 py-0.5 text-xs border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors whitespace-nowrap"
                    style={mono}
                  >
                    MARK AS DONE
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── DAILY INSTRUCTIONS ── */}
      <section className={`mb-6 ${exitFlash ? "animate-exit-flash" : ""}`} id="daily-instructions">
        <h2 className="text-sm font-semibold text-[var(--dim)] mb-2 tracking-widest">
          DAILY INSTRUCTIONS{instructions.length > 0 ? ` — ${fmtDate(new Date().toISOString())}` : ""}
        </h2>
        <div className="border border-[var(--border)] bg-[var(--card)] p-4">
          {instructions.length === 0 ? (
            <p className="text-xs text-[var(--dim)]" style={mono}>
              No open positions. Run tonight&apos;s scan to check for signals.
            </p>
          ) : (
            <div className="space-y-0" style={mono}>
              {instructions.map((inst, i) => {
                if (inst.type === "EXIT") {
                  return (
                    <div key={inst.ticker} className={`${i > 0 ? "border-t border-[var(--border)] pt-4 mt-4" : ""}`}>
                      <div className="border border-[var(--red)] p-4" style={{ background: "#1a0000" }}>
                        <p className="text-base font-bold text-[var(--dim)] mb-3">─── {inst.ticker} ───</p>
                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                          <span className="text-[var(--red)] font-bold text-sm" style={{ gridColumn: "1 / -1" }}>
                            🔴 EXIT THIS POSITION
                          </span>
                          <span className="text-[var(--red)]">Today&apos;s close</span>
                          <span className="text-[var(--red)]">{inst.latestClose != null ? `${inst.currency}${inst.latestClose.toFixed(2)}` : "—"}</span>
                          <span className="text-[var(--red)]">Your stop</span>
                          <span className="text-[var(--red)]">{inst.currency}{inst.currentStop.toFixed(2)}</span>
                          <span className="text-[var(--red)]">Close broke stop by</span>
                          <span className="text-[var(--red)]">{inst.breakAmount != null ? `${inst.currency}${inst.breakAmount.toFixed(2)}` : "—"}</span>
                          <span className="text-[var(--red)] font-bold mt-1">Action</span>
                          <span className="text-[var(--red)] font-bold mt-1">Sell at market open tomorrow on Trading 212</span>
                          <span className="text-[var(--dim)]">Expected exit</span>
                          <span className="text-[var(--dim)]">~{inst.latestClose != null ? `${inst.currency}${inst.latestClose.toFixed(2)}` : "—"} (market open price may differ)</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                if (inst.type === "UPDATE_STOP") {
                  return (
                    <div key={inst.ticker} className={`${i > 0 ? "border-t border-[var(--border)] pt-4 mt-4" : ""}`}>
                      <div className="border-l-2 border-l-[var(--amber)] pl-4">
                        <p className="text-base font-bold text-[var(--dim)] mb-3">─── {inst.ticker} ───</p>
                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                          <span className="text-[var(--amber)] font-bold text-sm" style={{ gridColumn: "1 / -1" }}>
                            ⚠ UPDATE YOUR STOP ON TRADING 212
                          </span>
                          <span className="text-[var(--dim)]">Move stop from</span>
                          <span className="text-[var(--dim)]">{inst.oldStop != null ? `${inst.currency}${inst.oldStop.toFixed(2)}` : "—"}</span>
                          <span className="text-[var(--amber)]">Move stop to</span>
                          <span className="text-[var(--amber)] font-bold">{inst.newStop != null ? `${inst.currency}${inst.newStop.toFixed(2)}` : "—"}</span>
                          <span className="text-[var(--dim)]">Change</span>
                          <span className="text-[var(--green)]">+{inst.changeAmount != null ? `${inst.currency}${inst.changeAmount.toFixed(2)}` : "—"} (stop ratcheted up — locking in profit)</span>
                          <span className="text-[var(--amber)] font-bold mt-1">Do this</span>
                          <span className="text-[var(--amber)] font-bold mt-1">Before market open tomorrow</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                // HOLD
                return (
                  <div key={inst.ticker} className={`${i > 0 ? "border-t border-[var(--border)] pt-4 mt-4" : ""}`}>
                    <p className="text-base font-bold text-[var(--dim)] mb-3">─── {inst.ticker} ───</p>
                    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-[#555]">
                      <span>Status</span>
                      <span>HOLD — no action needed today{inst.actioned ? " (stop updated ✓)" : ""}</span>
                      <span>Your stop</span>
                      <span>{inst.currency}{inst.currentStop.toFixed(2)}</span>
                      <span>Set on</span>
                      <span>{inst.stopSetDate ? fmtDate(inst.stopSetDate) : "entry day"}</span>
                      <span>Next check</span>
                      <span>Tomorrow evening after scan</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── OPEN POSITIONS ── */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-[var(--dim)] mb-2 tracking-widest">OPEN POSITIONS</h2>
        <div className="border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
          <table className="w-full text-sm" style={mono}>
            <thead>
              <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                <th className="text-left px-3 py-2">TICKER</th>
                <th className="text-left px-3 py-2">ENTRY DATE</th>
                <th className="text-right px-3 py-2">ENTRY</th>
                <th className="text-right px-3 py-2">CURRENT</th>
                <th className="text-right px-3 py-2">SHARES</th>
                <th className="text-right px-3 py-2">HARD STOP</th>
                <th className="text-right px-3 py-2">TRAIL STOP</th>
                <th className="text-right px-3 py-2">ACTIVE STOP</th>
                <th className="text-right px-3 py-2">T212 STOP</th>
                <th className="text-right px-3 py-2">RISK</th>
                <th className="text-right px-3 py-2">P&amp;L</th>
                <th className="text-center px-3 py-2">STATUS</th>
                <th className="text-center px-3 py-2"></th>
                <th className="text-center px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows cols={14} />
              ) : openTrades.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
                    No open positions — scan running tonight
                  </td>
                </tr>
              ) : (
                openTrades.map((t) => {
                  const activeStop = Math.max(t.hardStop, t.trailingStop);
                  const ratcheted = t.trailingStop > t.hardStop;
                  const dollarRisk = (t.entryPrice - t.hardStop) * t.shares;
                  const isExiting = exitingTradeId === t.id;
                  const isExpanded = expandedTradeId === t.id;
                  const stopHistory = (t as TradeWithHistory).stopHistory ?? [];
                  const c = tickerCurrency(t.ticker);
                  const sd = syncData[t.id];
                  const t212 = sd?.t212 ?? null;
                  const currentPrice = t212?.currentPrice ?? sd?.latestClose ?? null;
                  const pnl = t212 ? t212.ppl : (currentPrice != null ? (currentPrice - t.entryPrice) * t.shares : null);
                  const pnlSource = t212 ? "T212" : "Yahoo";
                  const isSyncing = syncingTradeId === t.id;
                  return (
                    <React.Fragment key={t.id}>
                      <tr
                        className={`border-b border-[var(--border)] hover:bg-[#1a1a1a] cursor-pointer ${isSyncing ? "opacity-50" : ""}`}
                        onClick={() => setExpandedTradeId(isExpanded ? null : t.id)}
                      >
                        <td className="px-3 py-2 font-semibold text-[var(--green)]">
                          {t.ticker}
                          <span className="text-[var(--dim)] text-[10px] ml-1">{isExpanded ? "▲" : "▼"}</span>
                        </td>
                        <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(t.entryDate)}</td>
                        <td className="px-3 py-2 text-right">{fmtPrice(t.entryPrice, c)}</td>
                        <td className="px-3 py-2 text-right">
                          {currentPrice != null ? (
                            <span className={currentPrice >= t.entryPrice ? "text-[var(--green)]" : "text-[var(--red)]"}>
                              {fmtPrice(currentPrice, c)}
                            </span>
                          ) : (
                            <span className="text-[var(--dim)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{t.shares >= 1 ? t.shares : t.shares.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right text-[var(--red)]">{fmtPrice(t.hardStop, c)}</td>
                        <td className="px-3 py-2 text-right text-[var(--amber)]">{fmtPrice(t.trailingStop, c)}</td>
                        <td className={`px-3 py-2 text-right ${ratcheted ? "text-[var(--green)]" : "text-[var(--dim)]"}`}>
                          {fmtPrice(activeStop, c)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {t212?.stopLoss != null ? (
                            <div>
                              <span className={t212.stopLoss >= activeStop - 0.01 ? "text-[var(--green)]" : "text-[var(--amber)]"}>
                                {fmtPrice(t212.stopLoss, c)}
                              </span>
                              {t212.stopLoss < activeStop - 0.01 && (
                                <span className="block text-[8px] text-[var(--amber)]">needs update</span>
                              )}
                            </div>
                          ) : t212 ? (
                            <span className="text-[var(--red)] text-[10px]">not set</span>
                          ) : (
                            <span className="text-[var(--dim)]">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--red)]">{fmtPrice(dollarRisk, c)}</td>
                        <td className="px-3 py-2 text-right">
                          {pnl != null ? (
                            <div>
                              <span className={pnl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}>
                                {pnl >= 0 ? "+" : "-"}{fmtPrice(Math.abs(pnl), c)}
                              </span>
                              {t212 && <span className="block text-[8px] text-[var(--green)]">T212</span>}
                            </div>
                          ) : (
                            <span className="text-[var(--dim)]">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <Badge label="OPEN" color="var(--green)" />
                            {t212 ? (
                              <span className="text-[8px] text-[var(--green)]">T212 ✓</span>
                            ) : sd ? (
                              <span className="text-[8px] text-[var(--dim)]">T212 ?</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => syncPosition(t.id)}
                            disabled={isSyncing || syncingAll}
                            className="px-2 py-0.5 text-xs border border-[#333] text-[var(--dim)] hover:text-[var(--amber)] hover:border-[var(--amber)] transition-colors disabled:opacity-40"
                            style={mono}
                          >
                            {isSyncing ? "↻ syncing..." : "↻ SYNC"}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                          {isExiting ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.01"
                                value={exitPrice}
                                onChange={(e) => setExitPrice(e.target.value)}
                                placeholder="Exit price"
                                className="w-20 px-1 py-0.5 text-xs bg-[#0a0a0a] border border-[var(--border)] text-white"
                                style={mono}
                              />
                              <button
                                onClick={() => markExited(t.id)}
                                className="px-2 py-0.5 text-xs border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-black transition-colors"
                                style={mono}
                              >
                                CONFIRM
                              </button>
                              <button
                                onClick={() => { setExitingTradeId(null); setExitPrice(""); }}
                                className="px-1 py-0.5 text-xs text-[var(--dim)]"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setExitingTradeId(t.id)}
                              className="px-2 py-0.5 text-xs border border-[#333] text-[var(--dim)] hover:text-[var(--red)] hover:border-[var(--red)] transition-colors"
                              style={mono}
                            >
                              MARK EXITED
                            </button>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={14} className="px-3 py-3 bg-[#0d0d0d]">
                            <p className="text-xs font-semibold text-[var(--dim)] mb-2 tracking-widest">
                              STOP HISTORY — {t.ticker}
                            </p>
                            {stopHistory.length === 0 ? (
                              <p className="text-xs text-[var(--dim)]">No stop history yet — will populate after next scan.</p>
                            ) : (
                              <table className="w-full text-xs" style={mono}>
                                <thead>
                                  <tr className="text-[var(--dim)]">
                                    <th className="text-left px-2 py-1">DATE</th>
                                    <th className="text-right px-2 py-1">STOP LEVEL</th>
                                    <th className="text-left px-2 py-1">TYPE</th>
                                    <th className="text-left px-2 py-1">CHANGE</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {stopHistory.map((sh, idx) => {
                                    const isLast = idx === stopHistory.length - 1;
                                    return (
                                      <tr
                                        key={sh.id}
                                        className={isLast ? "border-l-2 border-l-[var(--green)]" : ""}
                                      >
                                        <td className="px-2 py-1 text-[var(--dim)]">{fmtDate(sh.date)}</td>
                                        <td className={`px-2 py-1 text-right ${sh.stopType === "HARD" ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>
                                          {fmtPrice(sh.stopLevel, c)}
                                        </td>
                                        <td className={`px-2 py-1 ${sh.stopType === "HARD" ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>
                                          {sh.stopType === "HARD" ? "Hard stop" : "Trailing"}
                                        </td>
                                        <td className="px-2 py-1">
                                          {sh.changed && sh.changeAmount ? (
                                            <span className="text-[var(--green)]">▲ +{fmtPrice(sh.changeAmount, c)} (stop moved up)</span>
                                          ) : idx === 0 ? (
                                            <span className="text-[var(--dim)]">Initial entry</span>
                                          ) : (
                                            <span className="text-[#444]">No change</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── TWO-COLUMN: SIGNALS + SCAN ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 mb-6">
        {/* Signal Log */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--dim)] mb-2 tracking-widest">SIGNAL LOG</h2>
          <div className="border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
            <table className="w-full text-sm" style={mono}>
              <thead>
                <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                  <th className="text-left px-3 py-2">DATE</th>
                  <th className="text-left px-3 py-2">TICKER</th>
                  <th className="text-right px-3 py-2">VOL RATIO</th>
                  <th className="text-right px-3 py-2">RANGE POS</th>
                  <th className="text-center px-3 py-2">ACTION</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={5} />
                ) : recentSignals.filter((s) => s.signalFired).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
                      No signals in the last 14 days
                    </td>
                  </tr>
                ) : (
                  recentSignals
                    .filter((s) => s.signalFired)
                    .map((s) => {
                      const actionColor =
                        s.actionTaken === "ENTERED"
                          ? "var(--green)"
                          : s.actionTaken === "SKIPPED_MAX_POSITIONS"
                            ? "var(--amber)"
                            : "var(--dim)";
                      return (
                        <tr key={s.id} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                          <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(s.scanDate)}</td>
                          <td className="px-3 py-2 font-semibold">{s.ticker}</td>
                          <td className="px-3 py-2 text-right text-[var(--green)]">
                            {s.volumeRatio != null ? s.volumeRatio.toFixed(1) + "x" : "—"}
                          </td>
                          <td
                            className="px-3 py-2 text-right"
                            style={{
                              color:
                                s.rangePosition != null && s.rangePosition >= 0.75
                                  ? "var(--green)"
                                  : "var(--dim)",
                            }}
                          >
                            {s.rangePosition != null ? s.rangePosition.toFixed(2) : "—"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Badge label={s.actionTaken ?? "—"} color={actionColor} />
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Scan Panel */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--dim)] mb-2 tracking-widest">NIGHTLY SCAN</h2>
          <div className="border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => runScan(true)}
                disabled={scanRunning}
                className="flex-1 px-4 py-2 text-sm border border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[var(--amber)] transition-colors disabled:opacity-40"
                style={mono}
              >
                {scanRunning ? "SCANNING…" : "RUN DRY SCAN"}
              </button>
              <button
                onClick={() => setShowConfirm(true)}
                disabled={scanRunning}
                className="flex-1 px-4 py-2 text-sm border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-black transition-colors font-semibold disabled:opacity-40"
                style={mono}
              >
                RUN LIVE SCAN
              </button>
            </div>

            {/* Status area */}
            <div className="text-xs" style={mono}>
              {scanRunning && (
                <p className="text-[var(--amber)] mb-2">Scanning universe… this may take a few minutes.</p>
              )}
              {scanError && <p className="text-[var(--red)] mb-2">Error: {scanError}</p>}
              {scanResult && (
                <div>
                  <p className="text-[var(--dim)] mb-1">
                    Scan completed{scanResult.dryRun ? " (DRY RUN)" : ""} — {scanResult.date}
                  </p>
                  <p className="mb-3">
                    Signals: <span className="text-[var(--green)]">{scanResult.summary.signalCount}</span>
                    {" · "}Entered: <span className="text-[var(--green)]">{scanResult.summary.entered}</span>
                    {" · "}Exited: <span className="text-[var(--red)]">{scanResult.summary.exited}</span>
                  </p>

                  {/* Signal Cards */}
                  {scanResult.signalsFired.length === 0 && (
                    <p className="text-[var(--dim)] mb-3">No signals today.</p>
                  )}
                  {scanResult.signalsFired.map((s) => (
                    <SignalCard
                      key={s.ticker}
                      signal={s}
                      dryRun={scanResult.dryRun}
                      onMarkPlaced={markPlaced}
                      placing={placingTicker === s.ticker}
                    />
                  ))}

                  {/* Near Misses */}
                  {scanResult.nearMisses.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[#555] font-semibold mb-1">NEAR MISSES</p>
                      {scanResult.nearMisses.map((nm, i) => (
                        <p key={i} className="text-[#555]">
                          {nm.ticker.padEnd(8)} vol {nm.volumeRatio.toFixed(1)}x{" "}
                          range {nm.rangePosition.toFixed(2)}{" "}
                          — {nm.failedOn === "VOLUME" ? "needs more volume" : "needs higher close"}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!scanRunning && !scanError && !scanResult && (
                <p className="text-[var(--dim)]">Run a scan to see today&apos;s signals.</p>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* ── TRADE HISTORY ── */}
      <section className="mb-6">
        <div className="flex items-center gap-4 mb-2">
          <h2 className="text-sm font-semibold text-[var(--dim)] tracking-widest">TRADE HISTORY</h2>
          {closedTrades.length > 0 && (
            <span className="text-xs text-[var(--dim)]" style={mono}>
              Win rate: <span className="text-white">{winRate}%</span> | Avg R:{" "}
              <span className={Number(avgR) >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}>
                {Number(avgR) >= 0 ? "+" : ""}
                {avgR}
              </span>
            </span>
          )}
        </div>
        <div className="border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
          <table className="w-full text-sm" style={mono}>
            <thead>
              <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                <th className="text-left px-3 py-2">TICKER</th>
                <th className="text-left px-3 py-2">ENTRY</th>
                <th className="text-left px-3 py-2">EXIT</th>
                <th className="text-right px-3 py-2">ENTRY PRICE</th>
                <th className="text-right px-3 py-2">EXIT PRICE</th>
                <th className="text-right px-3 py-2">R-MULTIPLE</th>
                <th className="text-center px-3 py-2">RESULT</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows cols={7} />
              ) : closedTrades.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
                    No closed trades yet
                  </td>
                </tr>
              ) : (
                closedTrades.map((t) => {
                  const r = t.rMultiple ?? 0;
                  const isWin = r > 0;
                  const c = tickerCurrency(t.ticker);
                  return (
                    <tr key={t.id} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                      <td className="px-3 py-2 font-semibold">{t.ticker}</td>
                      <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(t.entryDate)}</td>
                      <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(t.exitDate)}</td>
                      <td className="px-3 py-2 text-right">{fmtPrice(t.entryPrice, c)}</td>
                      <td className="px-3 py-2 text-right">{t.exitPrice != null ? fmtPrice(t.exitPrice, c) : "—"}</td>
                      <td
                        className="px-3 py-2 text-right"
                        style={{ color: isWin ? "var(--green)" : "var(--red)" }}
                      >
                        {isWin ? "+" : ""}
                        {r.toFixed(2)}R
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge label={isWin ? "WIN" : "LOSS"} color={isWin ? "var(--green)" : "var(--red)"} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── CONFIRM MODAL ── */}
      {showConfirm && (
        <ConfirmModal
          balance={balance}
          remaining={Math.max(0, 5 - openCount)}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => {
            setShowConfirm(false);
            runScan(false);
          }}
        />
      )}
    </main>
  );
}
