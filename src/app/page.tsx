"use client";

import React from "react";
import Link from "next/link";

import type { TradeWithHistory } from "./components/types";
import { mono, fmtDate, fmtMoney, fmtPrice, tickerCurrency, fmtTime } from "./components/helpers";
import { SkeletonRows } from "./components/SkeletonRows";
import { Badge } from "./components/Badge";
import { ConfirmModal } from "./components/ConfirmModal";
import { BuyConfirmModal } from "./components/BuyConfirmModal";
import { EquityCurvePanel } from "./components/EquityCurvePanel";
import { RegimeBanner } from "./components/RegimeBanner";
import { ScanHistorySection } from "./components/ScanHistorySection";
import { SignalCard } from "./components/SignalCard";
import { GradeLegend } from "./components/GradeLegend";
import { SignalPill } from "./components/SignalPill";
import { AlertPanel } from "./components/AlertPanel";
import { MomentumSummaryPanel } from "./components/MomentumSummaryPanel";
import CruiseControlPanel from "./components/CruiseControlPanel";
import { PortfolioSummaryCard } from "./components/PortfolioSummaryCard";
import { useDashboard } from "./hooks/useDashboard";

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function Home() {
  const {
    data, loading, refreshing,
    scanRunning, scanResult, scanError, showConfirm,
    placingTicker, exitingTradeId, exitPrice,
    editingBalance, balanceInput,
    expandedTradeId,
    syncingTradeId, syncingAll, syncData, exitFlash, lastSyncAt,
    pushingStopTradeId,
    pushingStopTicker,
    pendingStopPush,
    importingTicker,
    importingAll,
    errorMsg,
    successMsg,
    // derived
    openTrades, recentSignals, closedTrades,
    balance, openCount, exposurePct, winRate, avgR,
    instructions, actionItems,
    // async actions
    syncPosition, syncAllPositions, runScan,
    markPlaced, markExited, updateBalance, markActionDone,
    pushStopToT212,
    confirmPushStop,
    cancelStopPush,
    pushStopByTicker,
    importT212Position,
    importAllT212Positions,
    requestBuy,
    confirmBuy,
    cancelBuy,
    buyingSignal,
    buyingTicker,
    // UI actions
    dismissError, dismissSuccess, openConfirm, closeConfirm,
    startBalanceEdit, cancelBalanceEdit, setBalanceInput,
    startExit, cancelExit, setExitPrice,
    toggleExpand,
  } = useDashboard();

  const hasStopAction = instructions.some((i) => i.type === "UPDATE_STOP" || i.type === "T212_STOP_BEHIND")
    || actionItems.some((a) => a.type === "STOP_UPDATE" || a.type === "STOP_SYNC");

  const hasUnknownStopStatus = openTrades.some((t) => {
    const hasSyncData = Boolean(syncData[t.id]?.t212);
    const hasDashboardData = Boolean(data?.t212Prices?.[t.ticker]);
    return !hasSyncData && !hasDashboardData;
  });

  const hasStopMismatch = openTrades.some((t) => {
    const activeStop = Math.max(t.hardStop, t.trailingStop);
    const stopLoss = syncData[t.id]?.t212?.stopLoss ?? data?.t212Prices?.[t.ticker]?.stopLoss ?? null;
    if (stopLoss == null) return true;
    const tol = activeStop * 0.002;
    return stopLoss < activeStop - tol;
  });

  const stopAlignmentState = openTrades.length === 0
    ? "none"
    : hasUnknownStopStatus
      ? "unknown"
      : (hasStopAction || hasStopMismatch)
        ? "needs_update"
        : "aligned";

  // Ratchet stops state
  const [ratcheting, setRatcheting] = React.useState(false);
  const [ratchetMsg, setRatchetMsg] = React.useState<string | null>(null);
  // Trade history filter
  const [tradeFilter, setTradeFilter] = React.useState<"ALL" | "OPEN" | "CLOSED">("ALL");

  async function handleRatchet() {
    setRatcheting(true);
    setRatchetMsg(null);
    try {
      const res = await fetch("/api/trades/ratchet", { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        if (d.ratcheted > 0) {
          const moved = d.results.filter((r: { ratcheted: boolean }) => r.ratcheted)
            .map((r: { ticker: string; oldStop: number; newStop: number }) => `${r.ticker} $${r.oldStop.toFixed(2)}\u2192$${r.newStop.toFixed(2)}`)
            .join(" \u00B7 ");
          setRatchetMsg(`\u2713 ${d.ratcheted} updated: ${moved}${d.pushed > 0 ? ` \u00B7 ${d.pushed} pushed to T212` : ""}`);
        } else {
          setRatchetMsg("\u2014 No change \u2014 all stops already current");
        }
        // Refresh dashboard to show updated stops
        syncAllPositions();
      } else {
        setRatchetMsg("\u2717 Failed");
      }
    } catch {
      setRatchetMsg("\u2717 Network error");
    }
    setRatcheting(false);
    setTimeout(() => setRatchetMsg(null), 8000);
  }

  return (
    <main className="min-h-screen p-4 max-w-[1400px] mx-auto">
      {/* ── ERROR TOAST ── */}
      {errorMsg && (
        <div
          role="alert"
          className="fixed top-4 right-4 z-50 px-4 py-2 text-sm text-white bg-red-600/90 border border-red-500 rounded shadow-lg backdrop-blur-sm animate-fade-in"
          style={mono}
        >
          {errorMsg}
          <button onClick={dismissError} className="ml-3 text-white/70 hover:text-white">✕</button>
        </div>
      )}
      {/* ── SUCCESS TOAST ── */}
      {successMsg && (
        <div
          role="status"
          className="fixed top-4 right-4 z-50 px-4 py-2 text-sm text-white bg-green-600/90 border border-green-500 rounded shadow-lg backdrop-blur-sm animate-fade-in"
          style={mono}
        >
          {successMsg}
          <button onClick={dismissSuccess} className="ml-3 text-white/70 hover:text-white">✕</button>
        </div>
      )}
      {/* ── HEADER ── */}
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] pb-3 mb-6">
        <h1 className="text-xl font-bold tracking-tight mr-2 text-[var(--green)]" style={mono}>
          VolumeTurtle
        </h1>
        <nav className="flex items-center gap-4 text-sm mr-2" style={mono}>
          <span className="text-white font-semibold border-b-2 border-[var(--green)] pb-0.5">DASHBOARD</span>
          <Link href="/journal" className="text-[var(--dim)] hover:text-white transition-colors">JOURNAL</Link>
          <Link href="/momentum" className="text-[var(--dim)] hover:text-white transition-colors">MOMENTUM</Link>
          <Link href="/watchlist" className="text-[var(--dim)] hover:text-white transition-colors">WATCHLIST</Link>
          <Link href="/settings" className="text-[var(--dim)] hover:text-white transition-colors">SETTINGS</Link>
        </nav>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--green)]">
          <span className="w-2 h-2 rounded-full bg-[var(--green)] animate-pulse-live" />
          LIVE
        </span>
        {stopAlignmentState === "aligned" && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--green)] border border-[var(--green)]/40 px-2 py-0.5">
            ✓ ALL STOPS ALIGNED
          </span>
        )}
        {stopAlignmentState === "needs_update" && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--amber)] border border-[var(--amber)]/40 px-2 py-0.5">
            ⚠ STOP UPDATES NEEDED
          </span>
        )}
        {stopAlignmentState === "unknown" && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--dim)] border border-[var(--border)] px-2 py-0.5">
            ? STOP STATUS UNKNOWN
          </span>
        )}
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
                onKeyDown={(e) => { if (e.key === "Enter") updateBalance(); if (e.key === "Escape") cancelBalanceEdit(); }}
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
                onClick={cancelBalanceEdit}
                className="px-1 py-0.5 text-xs text-[var(--dim)]"
              >
                ✕
              </button>
            </span>
          ) : (
            <span
              className="text-white cursor-pointer hover:text-[var(--amber)] transition-colors"
              style={mono}
              onClick={() => startBalanceEdit(balance)}
              title="Click to edit balance"
            >
              {fmtMoney(balance)}
            </span>
          )}
          {lastSyncAt && !editingBalance && (
            <span className={`text-[10px] ml-1 ${Date.now() - new Date(lastSyncAt).getTime() > 86400_000 ? "text-[var(--amber)]" : "text-[var(--dim)]"}`} style={mono}>
              T212 {fmtTime(lastSyncAt)}
            </span>
          )}
        </span>
        <span className="text-[var(--border)]">|</span>
        <span className="text-sm text-[var(--dim)]">
          Open: <span className="text-white" style={mono}>{openCount}/5</span>
        </span>
        <span className="text-[var(--border)]">|</span>
        <span className="text-sm text-[var(--dim)]">
          Runner:{" "}
          {(() => {
            const runner = openTrades.find((t) => (t as unknown as { isRunner?: boolean }).isRunner);
            if (runner) {
              return <span className="text-[#00e5ff]" style={mono}>{runner.ticker}</span>;
            }
            return <span className="text-[#555]" style={mono}>NONE</span>;
          })()}
        </span>
        <span className="text-[var(--border)]">|</span>
        <span className="text-sm text-[var(--dim)]">
          Exposure: <span className="text-white" style={mono}>{exposurePct}%</span>
        </span>
        <span className="text-[var(--border)]">|</span>
        <span className="text-sm text-[var(--dim)]">
          Last scan: <span className="text-white" style={mono}>{fmtTime(data?.lastScanTime ?? null)}</span>
        </span>
        <span className="text-[var(--border)]">|</span>
        <span className="text-sm text-[var(--dim)]">
          Backup:{" "}
          {data?.lastBackupAt ? (
            <span className={
              Date.now() - new Date(data.lastBackupAt).getTime() > 25 * 3600_000
                ? "text-[var(--amber)]"
                : "text-white"
            } style={mono}>
              {fmtTime(data.lastBackupAt)} {Date.now() - new Date(data.lastBackupAt).getTime() > 25 * 3600_000 ? "⚠" : "✓"}
            </span>
          ) : (
            <span className="text-[var(--red)]" style={mono}>Never ✗</span>
          )}
        </span>
        {data?.scheduledScans && (
          <>
            <span className="text-[var(--border)]">|</span>
            <span className="text-sm text-[var(--dim)]">
              LSE:{" "}
              {data.scheduledScans.lse.missed ? (
                <span className="text-[var(--red)]" style={mono}>missed</span>
              ) : (
                <span className="text-white" style={mono}>{data.scheduledScans.lse.nextRun}</span>
              )}
            </span>
            <span className="text-sm text-[var(--dim)]">
              US:{" "}
              {data.scheduledScans.us.missed ? (
                <span className="text-[var(--red)]" style={mono}>missed</span>
              ) : (
                <span className="text-white" style={mono}>{data.scheduledScans.us.nextRun}</span>
              )}
            </span>
          </>
        )}
        {syncingAll && <span className="text-xs text-[var(--amber)] ml-auto">↻ Refreshing positions…</span>}
        <AlertPanel />
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

      {/* ── REGIME BANNER ── */}
      <RegimeBanner regime={data?.regime ?? null} />

      {/* ── CRUISE CONTROL ── */}
      <CruiseControlPanel />

      {/* ── EQUITY CURVE ── */}
      <EquityCurvePanel data={data?.equityCurve ?? null} snapshots={data?.sparklineSnapshots ?? []} />

      {/* ── MOMENTUM SUMMARY ── */}
      <MomentumSummaryPanel data={data?.momentumSummary ?? null} />

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
                  {a.type === "EXIT" ? "EXIT" : a.type === "STOP_UPDATE" ? "STOP" : a.type === "STOP_SYNC" ? "SYNC" : "SIGNAL"}
                </span>
                <span className={`font-semibold ${a.type === "EXIT" ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>
                  {a.ticker}
                </span>
                <span className="text-[var(--dim)] flex-1">{a.message}</span>
                {(a.type === "STOP_UPDATE" || a.type === "STOP_SYNC") && (() => {
                  const matchTrade = openTrades.find((t) => t.ticker === a.ticker);
                  return (
                    <>
                      {matchTrade && (
                        <button
                          onClick={() => pushStopToT212(matchTrade.id)}
                          disabled={pushingStopTradeId === matchTrade.id}
                          className="px-2 py-0.5 text-xs border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors whitespace-nowrap disabled:opacity-50"
                          style={mono}
                        >
                          {pushingStopTradeId === matchTrade.id ? "PUSHING…" : "UPDATE ON T212"}
                        </button>
                      )}
                      {a.stopHistoryId && (
                        <button
                          onClick={() => markActionDone(a.stopHistoryId!)}
                          className="px-2 py-0.5 text-xs border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors whitespace-nowrap"
                          style={mono}
                        >
                          MARK AS DONE
                        </button>
                      )}
                    </>
                  );
                })()}
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

                if (inst.type === "T212_EXIT") {
                  return (
                    <div key={inst.ticker} className={`${i > 0 ? "border-t border-[var(--border)] pt-4 mt-4" : ""}`}>
                      <div className="border border-[var(--red)] p-4" style={{ background: "#1a0000" }}>
                        <p className="text-base font-bold text-[var(--dim)] mb-3">─── {inst.ticker} ───</p>
                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                          <span className="text-[var(--red)] font-bold text-sm" style={{ gridColumn: "1 / -1" }}>
                            🔴 POSITION CLOSED BY T212
                          </span>
                          <span className="text-[var(--dim)]">Stop was</span>
                          <span className="text-[var(--dim)]">{inst.currency}{inst.currentStop.toFixed(2)}</span>
                          <span className="text-[var(--dim)]">EOD close</span>
                          <span className="text-[var(--dim)]">{inst.latestClose != null ? `${inst.currency}${inst.latestClose.toFixed(2)}` : "—"}</span>
                          <span className="text-[var(--red)] font-bold mt-1">Action</span>
                          <span className="text-[var(--red)] font-bold mt-1">Click ↻ SYNC to confirm exit and close trade</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                if (inst.type === "UPDATE_STOP") {
                  const matchTrade = openTrades.find((t) => t.ticker === inst.ticker);
                  const isImported = matchTrade?.importedFromT212;
                  return (
                    <div key={inst.ticker} className={`${i > 0 ? "border-t border-[var(--border)] pt-4 mt-4" : ""}`}>
                      <div className="border-l-2 border-l-[var(--amber)] pl-4">
                        <p className="text-base font-bold text-[var(--dim)] mb-3">
                          ─── {inst.ticker}
                          {isImported ? <span className="text-[var(--amber)] text-xs ml-2">(📥 T212 Import)</span> : <span className="text-[var(--green)] text-xs ml-2">(📊 Signal)</span>}
                          {" "}───
                        </p>
                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                          <span className="text-[var(--amber)] font-bold text-sm" style={{ gridColumn: "1 / -1" }}>
                            ⚠ UPDATE YOUR STOP ON TRADING 212
                          </span>
                          <span className="text-[var(--dim)]">Trading 212 stop now</span>
                          <span className="text-[var(--dim)]">{inst.t212Stop != null ? `${inst.currency}${inst.t212Stop.toFixed(2)}` : "not set"}</span>
                          <span className="text-[var(--dim)]">Move stop from</span>
                          <span className="text-[var(--dim)]">{inst.oldStop != null ? `${inst.currency}${inst.oldStop.toFixed(2)}` : "—"}</span>
                          <span className="text-[var(--amber)]">Move stop to</span>
                          <span className="text-[var(--amber)] font-bold">{inst.newStop != null ? `${inst.currency}${inst.newStop.toFixed(2)}` : "—"}</span>
                          <span className="text-[var(--dim)]">Change</span>
                          <span className="text-[var(--green)]">+{inst.changeAmount != null ? `${inst.currency}${inst.changeAmount.toFixed(2)}` : "—"} (stop ratcheted up — locking in profit)</span>
                          <span className="text-[var(--amber)] font-bold mt-1">Do this</span>
                          <span className="text-[var(--amber)] font-bold mt-1">Before market open tomorrow</span>
                          {matchTrade && (
                            <>
                              <span className="mt-2" />
                              <span className="mt-2">
                                <button
                                  onClick={() => pushStopToT212(matchTrade.id)}
                                  disabled={pushingStopTradeId === matchTrade.id}
                                  className="px-3 py-1 text-xs font-bold border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors disabled:opacity-50"
                                  style={mono}
                                >
                                  {pushingStopTradeId === matchTrade.id ? "PUSHING…" : "⚡ UPDATE ON T212"}
                                </button>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                if (inst.type === "T212_STOP_BEHIND") {
                  const matchTrade = openTrades.find((t) => t.ticker === inst.ticker);
                  const isImported = matchTrade?.importedFromT212;
                  return (
                    <div key={inst.ticker} className={`${i > 0 ? "border-t border-[var(--border)] pt-4 mt-4" : ""}`}>
                      <div className="border-l-2 border-l-[var(--amber)] pl-4">
                        <p className="text-base font-bold text-[var(--dim)] mb-3">
                          ─── {inst.ticker}
                          {isImported ? <span className="text-[var(--amber)] text-xs ml-2">(📥 T212 Import)</span> : <span className="text-[var(--green)] text-xs ml-2">(📊 Signal)</span>}
                          {" "}───
                        </p>
                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                          <span className="text-[var(--amber)] font-bold text-sm" style={{ gridColumn: "1 / -1" }}>
                            ⚠ T212 STOP IS BEHIND — UPDATE REQUIRED
                          </span>
                          <span className="text-[var(--amber)]">T212 stop</span>
                          <span className="text-[var(--amber)]">{inst.t212Stop != null ? `${inst.currency}${inst.t212Stop.toFixed(2)}` : "—"}</span>
                          <span className="text-[var(--green)]">System stop</span>
                          <span className="text-[var(--green)] font-bold">{inst.currency}{inst.currentStop.toFixed(2)}</span>
                          <span className="text-[var(--dim)]">Difference</span>
                          <span className="text-[var(--red)]">{inst.changeAmount != null ? `${inst.currency}${inst.changeAmount.toFixed(2)} below` : "—"}</span>
                          <span className="text-[var(--amber)] font-bold mt-1">Action</span>
                          <span className="text-[var(--amber)] font-bold mt-1">Raise T212 stop to {inst.currency}{inst.currentStop.toFixed(2)}</span>
                          {matchTrade && (
                            <>
                              <span className="mt-2" />
                              <span className="mt-2">
                                <button
                                  onClick={() => pushStopToT212(matchTrade.id)}
                                  disabled={pushingStopTradeId === matchTrade.id}
                                  className="px-3 py-1 text-xs font-bold border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors disabled:opacity-50"
                                  style={mono}
                                >
                                  {pushingStopTradeId === matchTrade.id ? "PUSHING…" : "⚡ UPDATE ON T212"}
                                </button>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // HOLD
                return (
                  <div key={inst.ticker} className={`${i > 0 ? "border-t border-[var(--border)] pt-4 mt-4" : ""}`}>
                    <p className="text-base font-bold text-[var(--dim)] mb-3">
                      ─── {inst.ticker}
                      {(() => {
                        const matchTrade = openTrades.find((t) => t.ticker === inst.ticker);
                        const tradeIsRunner = (matchTrade as unknown as { isRunner?: boolean })?.isRunner === true;
                        const runnerActivated = (matchTrade as unknown as { runnerActivatedAt?: string | null })?.runnerActivatedAt != null;
                        if (tradeIsRunner) {
                          return (
                            <>
                              <span className="ml-1.5 inline-flex items-center px-1.5 py-0 text-[9px] font-bold border border-[#00e5ff] text-[#00e5ff] rounded-none align-middle">RUN</span>
                              <span className={`text-xs ml-2 ${runnerActivated ? "text-[#00e5ff]" : "text-[var(--amber)]"}`}>
                                {runnerActivated ? "(🏃 Runner Active)" : "(🏃 Runner Phase 1)"}
                              </span>
                            </>
                          );
                        }
                        if (matchTrade?.importedFromT212) return <span className="text-[var(--amber)] text-xs ml-2">(📥 T212 Import)</span>;
                        return <span className="text-[var(--green)] text-xs ml-2">(📊 Signal)</span>;
                      })()}
                      {" "}───
                    </p>
                    {(() => {
                      const matchTrade = openTrades.find((t) => t.ticker === inst.ticker);
                      const tradeIsRunner = (matchTrade as unknown as { isRunner?: boolean })?.isRunner === true;
                      const runnerActivated = (matchTrade as unknown as { runnerActivatedAt?: string | null })?.runnerActivatedAt != null;
                      const runnerPeakProfit = (matchTrade as unknown as { runnerPeakProfit?: number | null })?.runnerPeakProfit;

                      if (tradeIsRunner && !runnerActivated) {
                        // Runner Phase 1
                        const profitPct = matchTrade && inst.latestClose != null
                          ? ((inst.latestClose - matchTrade.entryPrice) / matchTrade.entryPrice * 100)
                          : null;
                        return (
                          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-[var(--amber)]">
                            <span>Status</span>
                            <span>HOLD — runner position, hard stop only</span>
                            <span>Current profit</span>
                            <span>{profitPct != null ? `+${profitPct.toFixed(1)}%` : "—"}</span>
                            <span>Waiting for</span>
                            <span>30% to activate wide exit</span>
                            <span>Hard stop</span>
                            <span>{inst.currency}{matchTrade ? matchTrade.hardStop.toFixed(2) : "—"}</span>
                          </div>
                        );
                      }

                      if (tradeIsRunner && runnerActivated) {
                        // Runner Phase 2
                        const profitPct = matchTrade && inst.latestClose != null
                          ? ((inst.latestClose - matchTrade.entryPrice) / matchTrade.entryPrice * 100)
                          : null;
                        return (
                          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-[#00e5ff]">
                            <span>Status</span>
                            <span>HOLD — RUNNER ACTIVE, wide exit logic on</span>
                            <span>Current profit</span>
                            <span>{profitPct != null ? `+${profitPct.toFixed(1)}%` : "—"}{runnerPeakProfit != null ? ` Peak: +${(runnerPeakProfit * 100).toFixed(1)}%` : ""}</span>
                            <span>20-day low stop</span>
                            <span>{inst.currency}{inst.currentStop.toFixed(2)}</span>
                            <span>Hard stop floor</span>
                            <span>{inst.currency}{matchTrade ? matchTrade.hardStop.toFixed(2) : "—"}</span>
                            <span>Next check</span>
                            <span>Tomorrow evening after scan</span>
                          </div>
                        );
                      }

                      // Normal HOLD
                      return (
                        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-[#555]">
                          <span>Status</span>
                          <span>HOLD — no action needed today{inst.actioned ? " (stop updated ✓)" : ""}</span>
                          <span>Your stop</span>
                          <span>{inst.currency}{inst.currentStop.toFixed(2)}</span>
                          <span>Trading 212 stop now</span>
                          <span>{inst.t212Stop != null ? `${inst.currency}${inst.t212Stop.toFixed(2)}` : "not set"}</span>
                          <span>Set on</span>
                          <span>{inst.stopSetDate ? fmtDate(inst.stopSetDate) : "entry day"}</span>
                          <span>Next check</span>
                          <span>Tomorrow evening after scan</span>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── PORTFOLIO SUMMARY CARD ── */}
      {!loading && (openCount > 0 || closedTrades.length > 0) && (
        <PortfolioSummaryCard
          openTrades={openTrades}
          closedTrades={closedTrades}
          syncData={syncData}
          t212Prices={data?.t212Prices ?? {}}
          gbpUsdRate={data?.gbpUsdRate ?? 1.27}
        />
      )}

      {/* ── P&L SUMMARY BAR ── */}
      {!loading && (openCount > 0 || closedTrades.length > 0) && (() => {
        const rate = data?.gbpUsdRate ?? 1.27;
        const isUsdTicker = (ticker: string) =>
          !ticker.endsWith(".L") && !ticker.endsWith(".AS") && !ticker.endsWith(".HE") && !ticker.endsWith(".ST") && !ticker.endsWith(".CO");

        // Unrealised P&L from open positions (using sync/T212 data when available)
        // Convert USD P&L to GBP so total is in £
        const unrealisedPnl = openTrades.reduce((sum, t) => {
          const sd = syncData[t.id];
          const t212 = sd?.t212 ?? (data?.t212Prices?.[t.ticker] ? { ...data.t212Prices[t.ticker], quantity: t.shares, averagePrice: t.entryPrice, confirmed: true } : null);
          const currentPrice = t212?.currentPrice ?? sd?.latestClose ?? null;
          const pnl = t212?.ppl ?? (currentPrice != null ? (currentPrice - t.entryPrice) * t.shares : 0);
          const pnlGbp = isUsdTicker(t.ticker) ? (pnl ?? 0) / rate : (pnl ?? 0);
          return sum + pnlGbp;
        }, 0);

        // This month's closed trades — convert USD P&L to GBP
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const thisMonthClosed = closedTrades.filter((t) => t.exitDate && new Date(t.exitDate) >= monthStart);
        const realisedPnl = thisMonthClosed.reduce((sum, t) => {
          const pl = t.exitPrice != null ? (t.exitPrice - t.entryPrice) * t.shares : 0;
          const plGbp = isUsdTicker(t.ticker) ? pl / rate : pl;
          return sum + plGbp;
        }, 0);

        return (
          <section className="mb-4">
            <div className="grid grid-cols-4 gap-3" style={mono}>
              <div className="border border-[var(--border)] bg-[var(--card)] px-4 py-3">
                <p className="text-[10px] text-[var(--dim)] tracking-widest mb-1">OPEN POSITIONS</p>
                <p className="text-lg font-bold text-white">{openCount}</p>
              </div>
              <div className="border border-[var(--border)] bg-[var(--card)] px-4 py-3">
                <p className="text-[10px] text-[var(--dim)] tracking-widest mb-1">UNREALISED P&amp;L</p>
                <p className={`text-lg font-bold ${unrealisedPnl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                  {unrealisedPnl >= 0 ? "+" : ""}{fmtMoney(Math.abs(unrealisedPnl))}
                </p>
              </div>
              <div className="border border-[var(--border)] bg-[var(--card)] px-4 py-3">
                <p className="text-[10px] text-[var(--dim)] tracking-widest mb-1">CLOSED THIS MONTH</p>
                <p className="text-lg font-bold text-white">{thisMonthClosed.length}</p>
              </div>
              <div className="border border-[var(--border)] bg-[var(--card)] px-4 py-3">
                <p className="text-[10px] text-[var(--dim)] tracking-widest mb-1">REALISED P&amp;L (MTD)</p>
                <p className={`text-lg font-bold ${realisedPnl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                  {realisedPnl >= 0 ? "+" : ""}{fmtMoney(Math.abs(realisedPnl))}
                </p>
              </div>
            </div>
          </section>
        );
      })()}

      {/* ── OPEN POSITIONS ── */}
      <section className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dim)] tracking-widest">OPEN POSITIONS</h2>
            <p className="text-[10px] text-[#444]">TradeCore positions — managed stops &amp; signals</p>
          </div>
          {openCount > 0 && (
            <button
              onClick={handleRatchet}
              disabled={ratcheting}
              className="px-3 py-0.5 text-[10px] border border-[var(--border)] text-[var(--dim)] hover:text-[var(--green)] hover:border-[var(--green)] transition-colors disabled:opacity-40"
              style={mono}
            >
              {ratcheting ? "RATCHETING\u2026" : "\u25B6 RATCHET STOPS"}
            </button>
          )}
          {ratchetMsg && (
            <span className={`text-[10px] ${ratchetMsg.startsWith("\u2713") ? "text-[var(--green)]" : ratchetMsg.startsWith("\u2717") ? "text-[var(--red)]" : "text-[var(--dim)]"}`} style={mono}>
              {ratchetMsg}
            </span>
          )}
        </div>
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
                <th className="text-center px-3 py-2">SOURCE</th>
                <th className="text-center px-3 py-2"></th>
                <th className="text-center px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows cols={14} />
              ) : openTrades.length === 0 && (!data?.t212Portfolio || data.t212Portfolio.length === 0) ? (
                <tr>
                  <td colSpan={14} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
                    No open positions — scan running tonight
                  </td>
                </tr>
              ) : (
                <>
                {openTrades.map((t) => {
                  const activeStop = Math.max(t.hardStop, t.trailingStop);
                  const ratcheted = t.trailingStop > t.hardStop;
                  const dollarRisk = (t.entryPrice - t.hardStop) * t.shares;
                  const isExiting = exitingTradeId === t.id;
                  const isExpanded = expandedTradeId === t.id;
                  const stopHistory = (t as TradeWithHistory).stopHistory ?? [];
                  const c = tickerCurrency(t.ticker);
                  const sd = syncData[t.id];
                  const t212 = sd?.t212 ?? (data?.t212Prices?.[t.ticker] ? { ...data.t212Prices[t.ticker], quantity: t.shares, averagePrice: t.entryPrice, confirmed: true } : null);
                  const currentPrice = t212?.currentPrice ?? sd?.latestClose ?? null;
                  const pnl = t212 ? t212.ppl : (currentPrice != null ? (currentPrice - t.entryPrice) * t.shares : null);
                  const isSyncing = syncingTradeId === t.id;
                  const displayedActiveStop = Math.max(activeStop, t212?.stopLoss ?? 0);
                  const tradeIsRunner = (t as unknown as { isRunner?: boolean }).isRunner === true;
                  const runnerActivated = (t as unknown as { runnerActivatedAt?: string | null }).runnerActivatedAt != null;
                  return (
                    <React.Fragment key={t.id}>
                      <tr
                        className={`border-b border-[var(--border)] hover:bg-[#1a1a1a] cursor-pointer ${isSyncing ? "opacity-50" : ""} ${tradeIsRunner ? "border-l-2 border-l-[#00e5ff]" : ""}`}
                        onClick={() => toggleExpand(t.id)}
                      >
                        <td className="px-3 py-2 font-semibold text-[var(--green)]">
                          {t.ticker}
                          {tradeIsRunner && (
                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0 text-[9px] font-bold border border-[#00e5ff] text-[#00e5ff] rounded-none align-middle">
                              RUN
                            </span>
                          )}
                          {tradeIsRunner && (
                            <span className={`block text-[9px] mt-0.5 ${runnerActivated ? "text-[#00e5ff]" : "text-[var(--amber)]"}`}>
                              {runnerActivated ? "PHASE 2 — wide exit active" : "PHASE 1 — waiting for 30%"}
                            </span>
                          )}
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
                        <td className={`px-3 py-2 text-right ${displayedActiveStop > activeStop ? "text-[var(--green)]" : ratcheted ? "text-[var(--green)]" : "text-[var(--dim)]"}`}>
                          {fmtPrice(displayedActiveStop, c)}
                        </td>
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          {t212?.stopLoss != null ? (() => {
                            const diff = t212.stopLoss - activeStop;
                            const tol = activeStop * 0.002; // 0.2% tolerance for "aligned"
                            if (diff > tol) {
                              // T212 stop is meaningfully ABOVE system stop
                              return (
                                <div>
                                  <span className="text-[var(--green)]">{fmtPrice(t212.stopLoss, c)}</span>
                                  <span className="block text-[8px] text-[var(--green)]">{"\u25B2"} BETTER</span>
                                </div>
                              );
                            } else if (diff >= -tol) {
                              // Within tolerance — effectively equal
                              return (
                                <div>
                                  <span className="text-[var(--green)]">{fmtPrice(t212.stopLoss, c)}</span>
                                  <span className="block text-[8px] text-[var(--green)]">{"\u2713"} ALIGNED</span>
                                </div>
                              );
                            } else {
                              // T212 stop is BELOW system stop
                              return (
                                <div>
                                  <span className="text-[var(--amber)]">{fmtPrice(t212.stopLoss, c)}</span>
                                  <span className="block text-[8px] text-[var(--amber)]">{"\u26A0"} BEHIND</span>
                                  <button
                                    onClick={() => pushStopToT212(t.id)}
                                    disabled={pushingStopTradeId === t.id}
                                    className="block mx-auto mt-0.5 px-1.5 py-0 text-[9px] border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors disabled:opacity-50 whitespace-nowrap"
                                    style={mono}
                                  >
                                    {pushingStopTradeId === t.id ? "\u2026" : "\u2191 FIX"}
                                  </button>
                                </div>
                              );
                            }
                          })() : t212 ? (
                            <div>
                              <span className="text-[var(--red)] text-[10px]">not set</span>
                              <button
                                onClick={() => pushStopToT212(t.id)}
                                disabled={pushingStopTradeId === t.id}
                                className="block mx-auto mt-0.5 px-1.5 py-0 text-[9px] border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors disabled:opacity-50 whitespace-nowrap"
                                style={mono}
                              >
                                {pushingStopTradeId === t.id ? "…" : "↑ SET"}
                              </button>
                            </div>
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
                            <SignalPill source={(t as unknown as { signalSource?: string }).signalSource} />
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
                                onClick={cancelExit}
                                className="px-1 py-0.5 text-xs text-[var(--dim)]"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startExit(t.id)}
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
                }
                {/* Untracked T212 positions */}
                {data?.t212Portfolio?.filter((p) => !p.tracked).map((p) => {
                  const c = tickerCurrency(p.ticker);
                  return (
                    <tr key={`t212-${p.ticker}`} className="border-b border-[var(--border)] hover:bg-[#1a1a1a] opacity-50 border-l-2 border-l-[var(--amber)]">
                      <td className="px-3 py-2 font-semibold text-[var(--dim)]">
                        {p.ticker}
                        <span className="text-[var(--amber)] text-[8px] ml-1">UNTRACKED</span>
                      </td>
                      <td className="px-3 py-2 text-[var(--dim)]">
                        {p.lastSignalDate ? (
                          <span className="text-[10px]">{fmtDate(p.lastSignalDate)}</span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">{fmtPrice(p.averagePrice, c)}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={p.currentPrice >= p.averagePrice ? "text-[var(--green)]" : "text-[var(--red)]"}>
                          {fmtPrice(p.currentPrice, c)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{p.quantity >= 1 ? p.quantity : p.quantity.toFixed(4)}</td>
                      <td className="px-3 py-2 text-right">
                        {p.suggestedHardStop != null ? (
                          <span className="text-[var(--red)]">{fmtPrice(p.suggestedHardStop, c)}</span>
                        ) : (
                          <span className="text-[var(--dim)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.suggestedTrailingStop != null ? (
                          <span className="text-[var(--amber)]">{fmtPrice(p.suggestedTrailingStop, c)}</span>
                        ) : (
                          <span className="text-[var(--dim)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.suggestedActiveStop != null ? (
                          <span className="text-[var(--green)]">{fmtPrice(p.suggestedActiveStop, c)}</span>
                        ) : (
                          <span className="text-[var(--dim)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.stopLoss != null ? (
                          <span className="text-[var(--amber)]">{fmtPrice(p.stopLoss, c)}</span>
                        ) : (
                          <span className="text-[var(--red)] text-[10px]">not set</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--dim)]">—</td>
                      <td className="px-3 py-2 text-right">
                        <span className={p.ppl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}>
                          {p.ppl >= 0 ? "+" : "-"}{fmtPrice(Math.abs(p.ppl), c)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => importT212Position(p)}
                          disabled={importingTicker === p.ticker}
                          className="px-2 py-0.5 text-[9px] border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors disabled:opacity-50 whitespace-nowrap"
                          style={mono}
                        >
                          {importingTicker === p.ticker ? "IMPORTING…" : "IMPORT → VT"}
                        </button>
                      </td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2" />
                    </tr>
                  );
                })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── T212 PORTFOLIO ── */}
      {data?.t212Portfolio && data.t212Portfolio.length > 0 && (() => {
        const untrackedCount = data.t212Portfolio!.filter((p) => !p.tracked).length;
        return (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--dim)] tracking-widest">
                TRADING 212 PORTFOLIO — {data.t212Portfolio!.length} position{data.t212Portfolio!.length > 1 ? "s" : ""}
              </h2>
              <p className="text-[10px] text-[#444]">Trading 212 portfolio — raw feed (source of truth)</p>
            </div>
            {untrackedCount > 0 && (
              <button
                onClick={importAllT212Positions}
                disabled={importingAll}
                className="px-3 py-1 text-xs font-bold border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors disabled:opacity-50"
                style={mono}
              >
                {importingAll ? "IMPORTING…" : `IMPORT ALL ${untrackedCount} UNTRACKED`}
              </button>
            )}
          </div>
          <div className="border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
            <table className="w-full text-sm" style={mono}>
              <thead>
                <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                  <th className="text-left px-3 py-2">TICKER</th>
                  <th className="text-right px-3 py-2">QTY</th>
                  <th className="text-right px-3 py-2">AVG PRICE</th>
                  <th className="text-right px-3 py-2">CURRENT</th>
                  <th className="text-right px-3 py-2">P&amp;L</th>
                  <th className="text-right px-3 py-2">STOP LOSS</th>
                  <th className="text-right px-3 py-2">HARD STOP</th>
                  <th className="text-right px-3 py-2">TRAIL STOP</th>
                  <th className="text-right px-3 py-2">ACTIVE STOP</th>
                  <th className="text-center px-3 py-2">TRACKED</th>
                  <th className="text-center px-3 py-2">LAST SIGNAL</th>
                  <th className="text-center px-3 py-2">SCAN HISTORY</th>
                  <th className="text-center px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.t212Portfolio.map((p) => {
                  const c = tickerCurrency(p.ticker);
                  const gradeColor = (g: string | null) =>
                    g === "A" ? "#00ff88"
                      : g === "B" ? "var(--green)"
                        : g === "C" ? "var(--amber)"
                          : g === "D" ? "var(--red)"
                            : "var(--dim)";
                  return (
                    <tr key={p.ticker} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                      <td className="px-3 py-2 font-semibold text-[var(--green)]">{p.ticker}</td>
                      <td className="px-3 py-2 text-right">{p.quantity >= 1 ? p.quantity : p.quantity.toFixed(4)}</td>
                      <td className="px-3 py-2 text-right">{fmtPrice(p.averagePrice, c)}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={p.currentPrice >= p.averagePrice ? "text-[var(--green)]" : "text-[var(--red)]"}>
                          {fmtPrice(p.currentPrice, c)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={p.ppl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}>
                          {p.ppl >= 0 ? "+" : "-"}{fmtPrice(Math.abs(p.ppl), c)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.stopLoss != null ? (
                          <div>
                            <span className={
                              p.suggestedActiveStop != null && p.stopLoss < p.suggestedActiveStop - 0.01
                                ? "text-[var(--amber)]"
                                : "text-[var(--green)]"
                            }>
                              {fmtPrice(p.stopLoss, c)}
                            </span>
                            {p.suggestedActiveStop != null && p.stopLoss < p.suggestedActiveStop - 0.01 && (
                              <span className="block text-[8px] text-[var(--amber)]">behind</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[var(--red)] text-[10px]">not set</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.suggestedHardStop != null ? (
                          <span className="text-[var(--red)]">{fmtPrice(p.suggestedHardStop, c)}</span>
                        ) : (
                          <span className="text-[var(--dim)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.suggestedTrailingStop != null ? (
                          <span className="text-[var(--amber)]">{fmtPrice(p.suggestedTrailingStop, c)}</span>
                        ) : (
                          <span className="text-[var(--dim)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.suggestedActiveStop != null ? (
                          <span className={
                            p.stopLoss != null && p.stopLoss < p.suggestedActiveStop - 0.01
                              ? "text-[var(--amber)]"
                              : "text-[var(--green)]"
                          }>
                            {fmtPrice(p.suggestedActiveStop, c)}
                          </span>
                        ) : (
                          <span className="text-[var(--dim)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {p.tracked ? (
                          <span className="text-[8px] text-[var(--green)]">TRACKED ✓</span>
                        ) : (
                          <button
                            onClick={() => importT212Position(p)}
                            disabled={importingTicker === p.ticker || importingAll}
                            className="px-2 py-0.5 text-[9px] border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors disabled:opacity-50 whitespace-nowrap"
                            style={mono}
                          >
                            {importingTicker === p.ticker ? "…" : "IMPORT → VT"}
                          </button>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {p.lastSignalDate ? (
                          <div>
                            <span className="font-bold" style={{ color: gradeColor(p.lastSignalGrade) }}>
                              {p.lastSignalGrade ?? "—"}
                            </span>
                            <span className="text-[var(--dim)] text-[10px] ml-1">{fmtDate(p.lastSignalDate)}</span>
                          </div>
                        ) : (
                          <span className="text-[var(--dim)] text-[10px]">no signal</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {p.scanHistory.length > 0 ? (
                          <div className="flex items-center justify-center gap-0.5">
                            {p.scanHistory.map((s, i) => (
                              <span
                                key={i}
                                title={`${fmtDate(s.date)} — ${s.signalFired ? `Signal ${s.compositeGrade ?? ""}` : "No signal"}${s.volumeRatio != null ? ` · Vol ${s.volumeRatio.toFixed(1)}x` : ""}${s.actionTaken ? ` · ${s.actionTaken}` : ""}`}
                                className="inline-block w-2.5 h-2.5 rounded-sm"
                                style={{
                                  backgroundColor: s.signalFired
                                    ? gradeColor(s.compositeGrade)
                                    : "#333",
                                }}
                              />
                            ))}
                            <span className="text-[var(--dim)] text-[8px] ml-1">
                              {p.scanHistory.filter((s) => s.signalFired).length}/{p.scanHistory.length}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[var(--dim)] text-[10px]">not scanned</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {(() => {
                          const needsFix = p.suggestedActiveStop != null && (
                            p.stopLoss == null || p.stopLoss < p.suggestedActiveStop - 0.01
                          );
                          if (!needsFix) return <span className="text-[8px] text-[var(--green)]">✓</span>;
                          return (
                            <button
                              onClick={() => pushStopByTicker(p.ticker, p.suggestedActiveStop!)}
                              disabled={pushingStopTicker === p.ticker}
                              className="px-2 py-0.5 text-[9px] border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors disabled:opacity-50 whitespace-nowrap"
                              style={mono}
                            >
                              {pushingStopTicker === p.ticker ? "…" : "↑ FIX STOP"}
                            </button>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        );
      })()}

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
                  <th className="text-center px-3 py-2">SOURCE</th>
                  <th className="text-center px-3 py-2">GRADE</th>
                  <th className="text-right px-3 py-2">VOL RATIO</th>
                  <th className="text-right px-3 py-2">RANGE POS</th>
                  <th className="text-center px-3 py-2">ACTION</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={7} />
                ) : recentSignals.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
                      No scan signals in the last 30 days
                    </td>
                  </tr>
                ) : (
                  recentSignals.map((s) => {
                      const actionColor =
                        s.actionTaken === "ENTERED" ? "var(--green)"
                          : s.actionTaken === "SKIPPED_MAX_POSITIONS" ? "var(--amber)"
                            : s.actionTaken === "SKIPPED_EQUITY_PAUSE" ? "var(--red)"
                              : s.actionTaken === "IMPORTED" ? "var(--dim)"
                                : s.actionTaken === "SIGNAL_FIRED" ? "var(--amber)"
                                  : "var(--dim)";
                      const gradeColor =
                        s.compositeGrade === "A" ? "#00ff88"
                          : s.compositeGrade === "B" ? "var(--green)"
                            : s.compositeGrade === "C" ? "var(--amber)"
                              : s.compositeGrade === "D" ? "var(--red)"
                                : "var(--dim)";
                      const actionLabel =
                        s.actionTaken === "SKIPPED_EQUITY_PAUSE" ? "PAUSED"
                          : s.actionTaken === "SKIPPED_MAX_POSITIONS" ? "MAX POS"
                            : s.actionTaken === "SIGNAL_FIRED" ? "NOT ENTERED"
                              : s.actionTaken === "IMPORTED" ? "IMPORTED"
                                : s.actionTaken === "MANUAL" ? "MANUAL"
                                  : s.actionTaken ?? "\u2014";
                      const source = (s as unknown as { signalSource?: string }).signalSource ?? "volume";
                      return (
                        <tr key={s.id} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                          <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(s.scanDate)}</td>
                          <td className="px-3 py-2 font-semibold">{s.ticker}</td>
                          <td className="px-3 py-2 text-center">
                            <SignalPill source={source} />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {s.compositeGrade ? (
                              <span className="font-bold" style={{ color: gradeColor }}>{s.compositeGrade}</span>
                            ) : (
                              <span className="text-[var(--dim)]">{"\u2014"}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--green)]">
                            {s.volumeRatio != null ? s.volumeRatio.toFixed(1) + "x" : "\u2014"}
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
                            {s.rangePosition != null ? s.rangePosition.toFixed(2) : "\u2014"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Badge label={actionLabel} color={actionColor} />
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
                onClick={openConfirm}
                disabled={scanRunning}
                className="flex-1 px-4 py-2 text-sm border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-black transition-colors font-semibold disabled:opacity-40"
                style={mono}
              >
                RUN LIVE SCAN
              </button>
            </div>

            <GradeLegend />

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
                      onBuyNow={requestBuy}
                      placing={placingTicker === s.ticker}
                      buying={buyingTicker === s.ticker}
                      equityCurve={scanResult.equityCurve}
                      t212Configured={data?.t212Portfolio != null}
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
                          {nm.potentialScore != null && (
                            <span className="text-[#666]">
                              potential {nm.potentialScore.toFixed(2)} {nm.potentialGrade}{" "}
                            </span>
                          )}
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
          <div className="flex gap-1 ml-auto" style={mono}>
            {(["ALL", "OPEN", "CLOSED"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTradeFilter(f)}
                className={`px-3 py-0.5 text-[10px] border transition-colors ${
                  tradeFilter === f
                    ? "border-[var(--green)] text-[var(--green)]"
                    : "border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[#555]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
          {(() => {
            const allTrades = [...openTrades.map((t) => ({ ...t, _isOpen: true as const })), ...closedTrades.map((t) => ({ ...t, _isOpen: false as const }))];
            const filtered = tradeFilter === "OPEN"
              ? allTrades.filter((t) => t._isOpen)
              : tradeFilter === "CLOSED"
                ? allTrades.filter((t) => !t._isOpen)
                : allTrades;
            const sorted = [...filtered].sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime());

            return (
              <table className="w-full text-sm" style={mono}>
                <thead>
                  <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                    <th className="text-left px-3 py-2">TICKER</th>
                    <th className="text-left px-3 py-2">ENTRY</th>
                    <th className="text-left px-3 py-2">EXIT</th>
                    <th className="text-right px-3 py-2">ENTRY PRICE</th>
                    <th className="text-right px-3 py-2">EXIT PRICE</th>
                    <th className="text-right px-3 py-2">R-MULTIPLE</th>
                    <th className="text-right px-3 py-2">P/L</th>
                    <th className="text-center px-3 py-2">RESULT</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonRows cols={8} />
                  ) : sorted.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
                        {tradeFilter === "OPEN" ? "No open trades" : tradeFilter === "CLOSED" ? "No closed trades yet" : "No trades yet"}
                      </td>
                    </tr>
                  ) : (
                    sorted.map((t) => {
                      const r = t.rMultiple ?? 0;
                      const c = tickerCurrency(t.ticker);
                      if (t._isOpen) {
                        // Open trade — show current unrealised P&L
                        const sd = syncData[t.id];
                        const t212d = sd?.t212 ?? (data?.t212Prices?.[t.ticker] ? { ...data.t212Prices[t.ticker] } : null);
                        const curPrice = t212d?.currentPrice ?? sd?.latestClose ?? null;
                        const uPnl = curPrice != null ? (curPrice - t.entryPrice) * t.shares : null;
                        return (
                          <tr key={t.id} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                            <td className="px-3 py-2 font-semibold text-[var(--green)]">{t.ticker}</td>
                            <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(t.entryDate)}</td>
                            <td className="px-3 py-2 text-[var(--dim)]">—</td>
                            <td className="px-3 py-2 text-right">{fmtPrice(t.entryPrice, c)}</td>
                            <td className="px-3 py-2 text-right text-[var(--dim)]">{curPrice != null ? fmtPrice(curPrice, c) : "—"}</td>
                            <td className="px-3 py-2 text-right text-[var(--dim)]">—</td>
                            <td className="px-3 py-2 text-right font-semibold"
                              style={{ color: uPnl != null && uPnl >= 0 ? "var(--green)" : "var(--red)" }}
                            >
                              {uPnl != null ? `${uPnl >= 0 ? "+" : ""}${c}${Math.abs(uPnl).toFixed(2)}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <Badge label="OPEN" color="var(--amber)" />
                            </td>
                          </tr>
                        );
                      }
                      // Closed trade
                      const isWin = r > 0;
                      const isFlat = r === 0;
                      const pl = t.exitPrice != null ? (t.exitPrice - t.entryPrice) * t.shares : null;
                      return (
                        <tr key={t.id} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                          <td className="px-3 py-2 font-semibold">{t.ticker}</td>
                          <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(t.entryDate)}</td>
                          <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(t.exitDate)}</td>
                          <td className="px-3 py-2 text-right">{fmtPrice(t.entryPrice, c)}</td>
                          <td className="px-3 py-2 text-right">{t.exitPrice != null ? fmtPrice(t.exitPrice, c) : "—"}</td>
                          <td
                            className="px-3 py-2 text-right"
                            style={{ color: isFlat ? "var(--dim)" : isWin ? "var(--green)" : "var(--red)" }}
                          >
                            {isWin ? "+" : ""}
                            {r.toFixed(2)}R
                          </td>
                          <td
                            className="px-3 py-2 text-right font-semibold"
                            style={{ color: pl != null && pl > 0 ? "var(--green)" : pl != null && pl < 0 ? "var(--red)" : "var(--dim)" }}
                          >
                            {pl != null ? `${pl >= 0 ? "+" : ""}${c}${Math.abs(pl).toFixed(2)}` : "—"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Badge label={isFlat ? "B/E" : isWin ? "WIN" : "LOSS"} color={isFlat ? "var(--dim)" : isWin ? "var(--green)" : "var(--red)"} />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            );
          })()}
        </div>
      </section>

      {/* ── RUNNER HISTORY ── */}
      {(() => {
        const runnerTrades = closedTrades.filter((t) => (t as unknown as { isRunner?: boolean }).isRunner === true);
        if (runnerTrades.length === 0) return null;

        const avgHoldDays = runnerTrades.reduce((sum, t) => {
          const hold = t.exitDate && t.entryDate
            ? Math.floor((new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / (1000 * 60 * 60 * 24))
            : 0;
          return sum + hold;
        }, 0) / runnerTrades.length;

        const runnerWithData = runnerTrades as unknown as Array<{
          id: string; ticker: string; entryDate: string; exitDate: string | null;
          entryPrice: number; exitPrice: number | null; shares: number;
          runnerPeakProfit: number | null; runnerExitProfit: number | null;
          runnerCaptureRate: number | null; rMultiple: number | null;
        }>;

        const avgPeak = runnerWithData.reduce((s, t) => s + (t.runnerPeakProfit ?? 0), 0) / runnerWithData.length;
        const avgCapture = runnerWithData.filter((t) => t.runnerCaptureRate != null).reduce((s, t) => s + (t.runnerCaptureRate ?? 0), 0) / (runnerWithData.filter((t) => t.runnerCaptureRate != null).length || 1);
        const avgExitProfit = runnerWithData.reduce((s, t) => s + (t.runnerExitProfit ?? 0), 0) / runnerWithData.length;

        return (
          <section className="mb-6">
            <h2 className="text-sm font-semibold text-[#00e5ff] mb-2 tracking-widest">🏃 RUNNER HISTORY</h2>
            <div className="border border-[#00e5ff]/30 bg-[var(--card)] overflow-x-auto">
              <table className="w-full text-sm" style={mono}>
                <thead>
                  <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                    <th className="text-left px-3 py-2">TICKER</th>
                    <th className="text-left px-3 py-2">ENTRY</th>
                    <th className="text-left px-3 py-2">EXIT</th>
                    <th className="text-right px-3 py-2">HOLD DAYS</th>
                    <th className="text-right px-3 py-2">PEAK PROFIT</th>
                    <th className="text-right px-3 py-2">EXIT PROFIT</th>
                    <th className="text-right px-3 py-2">CAPTURE RATE</th>
                    <th className="text-center px-3 py-2">RESULT</th>
                  </tr>
                </thead>
                <tbody>
                  {runnerWithData.map((t) => {
                    const holdDays = t.exitDate && t.entryDate
                      ? Math.floor((new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / (1000 * 60 * 60 * 24))
                      : 0;
                    const isWin = (t.runnerExitProfit ?? 0) > 0;
                    const c = tickerCurrency(t.ticker);
                    return (
                      <tr key={t.id} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                        <td className="px-3 py-2 font-semibold text-[#00e5ff]">{t.ticker}</td>
                        <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(t.entryDate)}</td>
                        <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(t.exitDate)}</td>
                        <td className="px-3 py-2 text-right">{holdDays}d</td>
                        <td className="px-3 py-2 text-right text-[var(--green)]">
                          {t.runnerPeakProfit != null ? `+${(t.runnerPeakProfit * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right" style={{ color: isWin ? "var(--green)" : "var(--red)" }}>
                          {t.runnerExitProfit != null ? `${isWin ? "+" : ""}${(t.runnerExitProfit * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {t.runnerCaptureRate != null ? `${(t.runnerCaptureRate * 100).toFixed(0)}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Badge label={isWin ? "WIN" : "LOSS"} color={isWin ? "var(--green)" : "var(--red)"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {runnerWithData.length >= 5 && (
                <div className="px-3 py-2 text-[10px] text-[var(--dim)] border-t border-[var(--border)]" style={mono}>
                  Runners: {runnerWithData.length} closed · Avg hold: {avgHoldDays.toFixed(0)}d · Avg peak: +{(avgPeak * 100).toFixed(1)}% · Avg capture: {(avgCapture * 100).toFixed(0)}% · Avg exit profit: {avgExitProfit >= 0 ? "+" : ""}{(avgExitProfit * 100).toFixed(1)}%
                </div>
              )}
            </div>
          </section>
        );
      })()}

      {/* ── SCAN HISTORY ── */}
      <ScanHistorySection entries={data?.scanHistory ?? []} loading={loading} />

      {/* ── CONFIRM MODAL ── */}
      {showConfirm && (
        <ConfirmModal
          balance={balance}
          remaining={Math.max(0, 5 - openCount)}
          onCancel={closeConfirm}
          onConfirm={() => {
            closeConfirm();
            runScan(false);
          }}
        />
      )}

      {/* ── BUY CONFIRM MODAL ── */}
      {buyingSignal && (
        <BuyConfirmModal
          signal={buyingSignal}
          onCancel={cancelBuy}
          onConfirm={confirmBuy}
          buying={buyingTicker != null}
        />
      )}

      {/* ── STOP PUSH CONFIRMATION MODAL ── */}
      {pendingStopPush && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" role="dialog" aria-modal="true" aria-labelledby="stop-confirm-title">
          <div className="border border-[#333] bg-[#111] p-6 w-full max-w-md" style={mono}>
            <h3 id="stop-confirm-title" className="text-lg font-semibold text-[var(--amber)] mb-4">⚠ UPDATE STOP ON TRADING 212</h3>
            <p className="text-sm text-[var(--dim)] mb-3">
              This will place a <span className="text-white">SELL STOP</span> order on your <span className="text-white">live T212 account</span>.
            </p>
            <div className="space-y-2 mb-4 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--dim)]">Ticker</span>
                <span className="text-white font-bold">{pendingStopPush.ticker}</span>
              </div>
              {pendingStopPush.t212Stop != null && (
                <div className="flex justify-between">
                  <span className="text-[var(--dim)]">Current T212 stop</span>
                  <span className="text-white">{pendingStopPush.currency}{pendingStopPush.t212Stop.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[var(--dim)]">New stop</span>
                <span className="text-[var(--green)] font-bold">{pendingStopPush.currency}{pendingStopPush.newStop.toFixed(2)}</span>
              </div>
              {pendingStopPush.t212Stop != null && pendingStopPush.newStop > pendingStopPush.t212Stop && (
                <div className="flex justify-between">
                  <span className="text-[var(--dim)]">Change</span>
                  <span className="text-[var(--green)]">+{pendingStopPush.currency}{(pendingStopPush.newStop - pendingStopPush.t212Stop).toFixed(2)} ↑</span>
                </div>
              )}
            </div>
            <div className="p-3 border border-[var(--amber)]/30 bg-[var(--amber)]/5 mb-4">
              <p className="text-xs text-[var(--amber)]">
                ⚠ Stops can only move UP, never down. Any existing stop order for this ticker will be cancelled and replaced. This action cannot be undone.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={cancelStopPush}
                className="px-4 py-2 text-sm border border-[#333] text-[var(--dim)] hover:text-white transition-colors"
              >
                CANCEL
              </button>
              <button
                onClick={confirmPushStop}
                disabled={pushingStopTradeId === pendingStopPush.tradeId}
                className="px-4 py-2 text-sm border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors font-semibold disabled:opacity-50"
              >
                {pushingStopTradeId === pendingStopPush.tradeId ? "PUSHING…" : "CONFIRM — UPDATE STOP"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
