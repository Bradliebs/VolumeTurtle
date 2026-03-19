"use client";

import React from "react";
import Link from "next/link";

import type { TradeWithHistory } from "./components/types";
import { mono, fmtDate, fmtMoney, fmtPrice, tickerCurrency, fmtTime } from "./components/helpers";
import { SkeletonRows } from "./components/SkeletonRows";
import { Badge } from "./components/Badge";
import { ConfirmModal } from "./components/ConfirmModal";
import { EquityCurvePanel } from "./components/EquityCurvePanel";
import { RegimeBanner } from "./components/RegimeBanner";
import { ScanHistorySection } from "./components/ScanHistorySection";
import { SignalCard } from "./components/SignalCard";
import { GradeLegend } from "./components/GradeLegend";
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
    syncingTradeId, syncingAll, syncData, exitFlash,
    errorMsg,
    // derived
    openTrades, recentSignals, closedTrades,
    balance, openCount, exposurePct, winRate, avgR,
    instructions, actionItems,
    // async actions
    syncPosition, syncAllPositions, runScan,
    markPlaced, markExited, updateBalance, markActionDone,
    // UI actions
    dismissError, openConfirm, closeConfirm,
    startBalanceEdit, cancelBalanceEdit, setBalanceInput,
    startExit, cancelExit, setExitPrice,
    toggleExpand,
  } = useDashboard();

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

      {/* ── EQUITY CURVE ── */}
      <EquityCurvePanel data={data?.equityCurve ?? null} snapshots={data?.sparklineSnapshots ?? []} />

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
                        onClick={() => toggleExpand(t.id)}
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
                  <th className="text-center px-3 py-2">GRADE</th>
                  <th className="text-right px-3 py-2">VOL RATIO</th>
                  <th className="text-right px-3 py-2">RANGE POS</th>
                  <th className="text-center px-3 py-2">ACTION</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows cols={6} />
                ) : recentSignals.filter((s) => s.signalFired).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
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
                          : s.actionTaken === "SKIPPED_MAX_POSITIONS" || s.actionTaken === "SKIPPED_EQUITY_PAUSE"
                            ? "var(--amber)"
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
                            : s.actionTaken ?? "—";
                      return (
                        <tr key={s.id} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                          <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(s.scanDate)}</td>
                          <td className="px-3 py-2 font-semibold">{s.ticker}</td>
                          <td className="px-3 py-2 text-center">
                            {s.compositeGrade ? (
                              <span className="font-bold" style={{ color: gradeColor }}>{s.compositeGrade}</span>
                            ) : (
                              <span className="text-[var(--dim)]">—</span>
                            )}
                          </td>
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
                      placing={placingTicker === s.ticker}
                      equityCurve={scanResult.equityCurve}
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
    </main>
  );
}
