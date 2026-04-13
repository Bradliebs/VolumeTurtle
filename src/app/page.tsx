"use client";

import React, { useEffect, useState, useMemo } from "react";

import type { TradeWithHistory } from "./components/types";
import { mono, fmtDate, fmtMoney, fmtPrice, tickerCurrency, fmtTime } from "./components/helpers";
import { SkeletonRows } from "./components/SkeletonRows";
import { Badge } from "./components/Badge";
import { ConfirmModal } from "./components/ConfirmModal";
import { BuyConfirmModal } from "./components/BuyConfirmModal";
import { EquityCurvePanel } from "./components/EquityCurvePanel";
import { RegimeBanner } from "./components/RegimeBanner";
import { BreadthPanel } from "./components/BreadthPanel";
import { ScanHistorySection } from "./components/ScanHistorySection";
import { SignalCard } from "./components/SignalCard";
import { GradeLegend } from "./components/GradeLegend";
import { SignalPill } from "./components/SignalPill";
import { MomentumSummaryPanel } from "./components/MomentumSummaryPanel";
import CruiseControlPanel from "./components/CruiseControlPanel";
import { PortfolioSummaryCard } from "./components/PortfolioSummaryCard";

// ── Domain hooks ────────────────────────────────────────────────────────────
import { useDashboardData } from "./hooks/useDashboardData";
import { useNotifications } from "./hooks/useNotifications";
import { usePositionSync } from "./hooks/usePositionSync";
import { useScanRunner } from "./hooks/useScanRunner";
import { useTradeActions } from "./hooks/useTradeActions";
import { useT212Actions } from "./hooks/useT212Actions";

// ── Extracted components ────────────────────────────────────────────────────
import { DashboardHeader } from "./components/DashboardHeader";
import { PnLSummaryBar } from "./components/PnLSummaryBar";
import { ActionItemsPanel } from "./components/ActionItemsPanel";
import { DailyInstructions } from "./components/DailyInstructions";
import { RunnerHistoryTable } from "./components/RunnerHistoryTable";

// ── Utilities ───────────────────────────────────────────────────────────────
import { calculateStopAlignment, groupAndAggregateClosedTrades } from "./components/dashboardUtils";

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function Home() {
  // ── 1. Data ─────────────────────────────────────────────────────────────
  const { data, loading, refreshing, refresh } = useDashboardData();

  // ── 2. Notifications ────────────────────────────────────────────────────
  const {
    errorMsg, successMsg, exitFlash,
    showError, showSuccess, dismissError, dismissSuccess, triggerExitFlash,
  } = useNotifications();

  // ── 3. Derived values ───────────────────────────────────────────────────
  const openTrades = data?.openTrades ?? [];
  const recentSignals = data?.recentSignals ?? [];
  const closedTrades = data?.closedTrades ?? [];
  const balance = data?.account?.balance ?? 0;
  const openCount = openTrades.length;
  const gbpUsdRate = data?.gbpUsdRate ?? 1.27;

  const totalExposure = openTrades.reduce((s, t) => {
    const posValue = t.entryPrice * t.shares;
    const isUsd = !t.ticker.endsWith(".L") && !t.ticker.endsWith(".AS") && !t.ticker.endsWith(".HE") && !t.ticker.endsWith(".ST") && !t.ticker.endsWith(".CO");
    return s + (isUsd ? posValue / gbpUsdRate : posValue);
  }, 0);
  const exposurePct = balance > 0 ? ((totalExposure / balance) * 100).toFixed(1) : "0.0";

  const wins = closedTrades.filter((t) => (t.rMultiple ?? 0) > 0).length;
  const winRate = closedTrades.length > 0 ? ((wins / closedTrades.length) * 100).toFixed(0) : "—";
  const avgR = closedTrades.length > 0
    ? (closedTrades.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / closedTrades.length).toFixed(2)
    : "—";

  const instructions = data?.instructions ?? [];
  const serverActions = data?.actions ?? [];

  // ── 4. Position sync ────────────────────────────────────────────────────
  const {
    syncingTradeId, syncingAll, syncData, lastSyncAt,
    syncPosition, syncAllPositions,
  } = usePositionSync(refresh, triggerExitFlash, showError, openCount);

  // ── 5. Scan runner ──────────────────────────────────────────────────────
  const {
    scanRunning, scanResult, scanError, showConfirm,
    runScan, openConfirm, closeConfirm,
  } = useScanRunner(refresh);

  // ── 6. Trade actions ────────────────────────────────────────────────────
  const {
    placingTicker, exitingTradeId, exitPrice,
    editingBalance, balanceInput, expandedTradeId,
    markPlaced, markExited, updateBalance,
    startExit, cancelExit, setExitPrice,
    startBalanceEdit, cancelBalanceEdit, setBalanceInput,
    toggleExpand,
  } = useTradeActions(refresh, showError, showSuccess);

  // ── 7. T212 actions ─────────────────────────────────────────────────────
  const {
    pushingStopTradeId, pushingStopTicker, pendingStopPush,
    importingTicker, importingAll,
    buyingSignal, buyingTicker,
    pushStopToT212, confirmPushStop, cancelStopPush, pushStopByTicker,
    importT212Position, importAllT212Positions,
    requestBuy, confirmBuy, cancelBuy, markActionDone,
  } = useT212Actions(refresh, syncAllPositions, showError, showSuccess, data, syncData);

  // ── 8. Action items (augmented with scan signals) ───────────────────────
  const actionItems = useMemo(() => {
    const items = [...serverActions];
    if (scanResult && !scanResult.dryRun) {
      for (const s of scanResult.signalsFired) {
        const alreadyPlaced = openTrades.some((t) => t.ticker === s.ticker);
        if (!alreadyPlaced) {
          items.push({
            type: "NEW_SIGNAL",
            ticker: s.ticker,
            message: `New signal — ${s.ticker} — see scan panel`,
            urgency: "MEDIUM",
          });
        }
      }
    }
    return items;
  }, [serverActions, scanResult, openTrades]);

  // ── 9. Stop alignment ──────────────────────────────────────────────────
  const stopAlignmentState = calculateStopAlignment(
    openTrades, syncData, data?.t212Prices, instructions, actionItems,
  );

  const unprotectedCount = openTrades.filter(
    (t) => t.stopPushedAt == null && (t.stopPushAttempts ?? 0) > 0,
  ).length;

  const hasStopAction = instructions.some(
    (i) => i.type === "UPDATE_STOP" || i.type === "T212_STOP_BEHIND",
  ) || actionItems.some(
    (a) => a.type === "STOP_UPDATE" || a.type === "STOP_SYNC",
  );

  // ── 10. Local state ────────────────────────────────────────────────────
  const [maxPerSector, setMaxPerSector] = useState(2);
  useEffect(() => {
    fetch("/api/execution/settings").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.maxPositionsPerSector) setMaxPerSector(d.maxPositionsPerSector);
    }).catch(() => {});
  }, []);

  const sectorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of openTrades) {
      const s = (t as TradeWithHistory & { sector?: string | null }).sector;
      if (s) counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [openTrades]);

  const [ratcheting, setRatcheting] = useState(false);
  const [ratchetMsg, setRatchetMsg] = useState<string | null>(null);
  const [tradeFilter, setTradeFilter] = useState<"ALL" | "OPEN" | "CLOSED">("ALL");
  const [closedView, setClosedView] = useState<"LATEST" | "GROUPED">("LATEST");
  const [expandedClosedTickers, setExpandedClosedTickers] = useState<Record<string, boolean>>({});

  // ── 11. Closed trade performance ──────────────────────────────────────
  const closedPerf = useMemo(() => groupAndAggregateClosedTrades(closedTrades), [closedTrades]);

  // ── 12. Helpers ───────────────────────────────────────────────────────
  function toggleClosedTicker(ticker: string) {
    setExpandedClosedTickers((prev) => ({ ...prev, [ticker]: !prev[ticker] }));
  }

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

  // ═══════════════════════════════════════════════════════════════════════
  // JSX
  // ═══════════════════════════════════════════════════════════════════════

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
      <DashboardHeader
        balance={balance}
        editingBalance={editingBalance}
        balanceInput={balanceInput}
        stopAlignmentState={stopAlignmentState}
        unprotectedCount={unprotectedCount}
        syncingAll={syncingAll}
        lastSyncAt={lastSyncAt}
        refreshing={refreshing}
        onStartBalanceEdit={startBalanceEdit}
        onCancelBalanceEdit={cancelBalanceEdit}
        onSetBalanceInput={setBalanceInput}
        onUpdateBalance={updateBalance}
        onSyncAll={syncAllPositions}
        ratcheting={ratcheting}
        ratchetMsg={ratchetMsg}
        onRatchet={handleRatchet}
        hasStopAction={hasStopAction}
      />

      {/* ── REGIME BANNER ── */}
      <RegimeBanner regime={data?.regime ?? null} breadth={data?.breadth ?? null} />

      {/* ── BREADTH PANEL ── */}
      <BreadthPanel breadth={data?.breadth ?? null} />

      {/* ── CRUISE CONTROL ── */}
      <CruiseControlPanel />

      {/* ── EQUITY CURVE ── */}
      <EquityCurvePanel data={data?.equityCurve ?? null} snapshots={data?.sparklineSnapshots ?? []} />

      {/* ── MOMENTUM SUMMARY ── */}
      <MomentumSummaryPanel data={data?.momentumSummary ?? null} />

      {/* ── ACTION REQUIRED ── */}
      <ActionItemsPanel
        actionItems={actionItems}
        onMarkDone={markActionDone}
        onSync={syncPosition}
        onPushStop={pushStopToT212}
        syncingTradeId={syncingTradeId}
        pushingStopTradeId={pushingStopTradeId}
      />

      {/* ── DAILY INSTRUCTIONS ── */}
      <DailyInstructions
        instructions={instructions}
        syncData={syncData}
        t212Prices={data?.t212Prices}
        syncingTradeId={syncingTradeId}
        pushingStopTradeId={pushingStopTradeId}
        exitFlash={exitFlash}
        openTrades={openTrades}
        onSync={syncPosition}
        onPushStop={pushStopToT212}
        onStartExit={startExit}
        onMarkDone={markActionDone}
      />

      {/* ── PORTFOLIO SUMMARY CARD ── */}
      {!loading && (openCount > 0 || closedTrades.length > 0) && (
        <PortfolioSummaryCard
          openTrades={openTrades}
          closedTrades={closedTrades}
          syncData={syncData}
          t212Prices={data?.t212Prices ?? {}}
          gbpUsdRate={gbpUsdRate}
        />
      )}

      {/* ── P&L SUMMARY BAR ── */}
      {!loading && (openCount > 0 || closedTrades.length > 0) && (
        <PnLSummaryBar
          openCount={openCount}
          openTrades={openTrades}
          closedTrades={closedTrades}
          syncData={syncData}
          t212Prices={data?.t212Prices}
          gbpUsdRate={gbpUsdRate}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════════
         OPEN POSITIONS (inline — not yet extracted)
         ══════════════════════════════════════════════════════════════════ */}
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
                <th className="text-center px-3 py-2">SECTOR</th>
                <th className="text-center px-3 py-2"></th>
                <th className="text-center px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows cols={16} />
              ) : openTrades.length === 0 && (!data?.t212Portfolio || data.t212Portfolio.length === 0) ? (
                <tr>
                  <td colSpan={16} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
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
                          {t.stopPushedAt == null && (t.stopPushAttempts ?? 0) > 0 && (
                            <span className="ml-1 text-[9px] text-[var(--red)] animate-pulse font-bold">⚠ NO STOP</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          {t212?.stopLoss != null ? (() => {
                            const diff = t212.stopLoss - activeStop;
                            const tol = activeStop * 0.002;
                            if (diff > tol) {
                              return (
                                <div>
                                  <span className="text-[var(--green)]">{fmtPrice(t212.stopLoss, c)}</span>
                                  <span className="block text-[8px] text-[var(--green)]">{"\u25B2"} BETTER</span>
                                </div>
                              );
                            } else if (diff >= -tol) {
                              return (
                                <div>
                                  <span className="text-[var(--green)]">{fmtPrice(t212.stopLoss, c)}</span>
                                  <span className="block text-[8px] text-[var(--green)]">{"\u2713"} ALIGNED</span>
                                </div>
                              );
                            } else {
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
                        <td className="px-3 py-2 text-center">
                          {(() => {
                            const sector = (t as TradeWithHistory & { sector?: string | null }).sector;
                            if (!sector) return <span className="text-[var(--dim)] text-[10px]">—</span>;
                            const count = sectorCounts[sector] ?? 0;
                            const atLimit = count >= maxPerSector;
                            return (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 border ${atLimit ? "border-[var(--amber)]/50 text-[var(--amber)] bg-[var(--amber)]/10" : "border-[var(--border)] text-[var(--dim)]"}`}
                                title={atLimit ? `Sector at concentration limit — no further ${sector} entries via auto-execution` : `${count}/${maxPerSector} ${sector} positions`}
                              >
                                {sector} {count}/{maxPerSector}
                              </span>
                            );
                          })()}
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

      {/* ══════════════════════════════════════════════════════════════════
         T212 PORTFOLIO (inline — not yet extracted)
         ══════════════════════════════════════════════════════════════════ */}
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

      {/* ══════════════════════════════════════════════════════════════════
         TWO-COLUMN: SIGNALS + SCAN (inline — not yet extracted)
         ══════════════════════════════════════════════════════════════════ */}
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

      {/* ══════════════════════════════════════════════════════════════════
         TRADE HISTORY (inline — not yet extracted)
         ══════════════════════════════════════════════════════════════════ */}
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
              {" | "}Closed P/L:{" "}
              {Object.keys(closedPerf.totalPnlByCurrency).length > 0 ? (
                Object.entries(closedPerf.totalPnlByCurrency)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([currency, value], idx) => (
                    <span key={currency} className={value >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}>
                      {idx > 0 ? "  /  " : ""}
                      {value >= 0 ? "+" : ""}
                      {currency}{Math.abs(value).toFixed(2)}
                    </span>
                  ))
              ) : (
                <span className="text-[var(--dim)]">—</span>
              )}
              {" | "}Cum R:{" "}
              <span className={closedPerf.totalR >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}>
                {closedPerf.totalR >= 0 ? "+" : ""}
                {closedPerf.totalR.toFixed(2)}R
              </span>
            </span>
          )}
          <div className="flex gap-1 ml-auto" style={mono}>
            {(["ALL", "OPEN", "CLOSED"] as const).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setTradeFilter(f);
                  if (f === "CLOSED") {
                    setClosedView("GROUPED");
                  }
                }}
                className={`px-3 py-0.5 text-[10px] border transition-colors ${
                  tradeFilter === f
                    ? "border-[var(--green)] text-[var(--green)]"
                    : "border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[#555]"
                }`}
              >
                {f}
              </button>
            ))}
            {tradeFilter === "CLOSED" && (
              <>
                <button
                  onClick={() => setClosedView("LATEST")}
                  className={`px-3 py-0.5 text-[10px] border transition-colors ${
                    closedView === "LATEST"
                      ? "border-[var(--amber)] text-[var(--amber)]"
                      : "border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[#555]"
                  }`}
                >
                  LATEST/TICKER
                </button>
                <button
                  onClick={() => setClosedView("GROUPED")}
                  className={`px-3 py-0.5 text-[10px] border transition-colors ${
                    closedView === "GROUPED"
                      ? "border-[var(--amber)] text-[var(--amber)]"
                      : "border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[#555]"
                  }`}
                >
                  GROUPED HISTORY
                </button>
              </>
            )}
          </div>
        </div>
        <div className="border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
          {(() => {
            if (tradeFilter === "CLOSED") {
              const groups = closedPerf.grouped;

              if (closedView === "LATEST") {
                return (
                  <table className="w-full text-sm" style={mono}>
                    <thead>
                      <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                        <th className="text-left px-3 py-2">TICKER</th>
                        <th className="text-left px-3 py-2">LAST ENTRY</th>
                        <th className="text-left px-3 py-2">LAST EXIT</th>
                        <th className="text-right px-3 py-2">LAST R</th>
                        <th className="text-right px-3 py-2">LAST P/L</th>
                        <th className="text-right px-3 py-2">TOTAL RUNS</th>
                        <th className="text-right px-3 py-2">TOTAL P/L</th>
                        <th className="text-right px-3 py-2">CUM R</th>
                        <th className="text-center px-3 py-2">RESULT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <SkeletonRows cols={9} />
                      ) : groups.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
                            No closed trades yet
                          </td>
                        </tr>
                      ) : (
                        groups.map((group) => {
                          const t = group.latest;
                          const c = tickerCurrency(t.ticker);
                          const latestR = t.rMultiple ?? 0;
                          const latestPnl = t.exitPrice != null ? (t.exitPrice - t.entryPrice) * t.shares : null;
                          const isWin = latestR > 0;
                          const isFlat = latestR === 0;
                          return (
                            <tr key={group.ticker} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                              <td className="px-3 py-2 font-semibold">{group.ticker}</td>
                              <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(t.entryDate)}</td>
                              <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(t.exitDate)}</td>
                              <td className="px-3 py-2 text-right" style={{ color: isFlat ? "var(--dim)" : isWin ? "var(--green)" : "var(--red)" }}>
                                {latestR >= 0 ? "+" : ""}{latestR.toFixed(2)}R
                              </td>
                              <td className="px-3 py-2 text-right font-semibold" style={{ color: latestPnl != null && latestPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                                {latestPnl != null ? `${latestPnl >= 0 ? "+" : ""}${c}${Math.abs(latestPnl).toFixed(2)}` : "—"}
                              </td>
                              <td className="px-3 py-2 text-right text-[var(--dim)]">{group.tradeCount}</td>
                              <td className="px-3 py-2 text-right font-semibold" style={{ color: group.totalPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                                {group.totalPnl >= 0 ? "+" : ""}{c}{Math.abs(group.totalPnl).toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-right" style={{ color: group.totalR >= 0 ? "var(--green)" : "var(--red)" }}>
                                {group.totalR >= 0 ? "+" : ""}{group.totalR.toFixed(2)}R
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
              }

              return (
                <table className="w-full text-sm" style={mono}>
                  <thead>
                    <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                      <th className="text-left px-3 py-2">TICKER</th>
                      <th className="text-left px-3 py-2">LAST EXIT</th>
                      <th className="text-right px-3 py-2">RUNS</th>
                      <th className="text-right px-3 py-2">TOTAL P/L</th>
                      <th className="text-right px-3 py-2">CUM R</th>
                      <th className="text-center px-3 py-2">DETAIL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <SkeletonRows cols={6} />
                    ) : groups.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
                          No closed trades yet
                        </td>
                      </tr>
                    ) : (
                      groups.map((group) => {
                        const c = tickerCurrency(group.ticker);
                        const isExpanded = Boolean(expandedClosedTickers[group.ticker]);
                        return (
                          <React.Fragment key={group.ticker}>
                            <tr className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                              <td className="px-3 py-2 font-semibold">{group.ticker}</td>
                              <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(group.latest.exitDate)}</td>
                              <td className="px-3 py-2 text-right text-[var(--dim)]">{group.tradeCount}</td>
                              <td className="px-3 py-2 text-right font-semibold" style={{ color: group.totalPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                                {group.totalPnl >= 0 ? "+" : ""}{c}{Math.abs(group.totalPnl).toFixed(2)}
                              </td>
                              <td className="px-3 py-2 text-right" style={{ color: group.totalR >= 0 ? "var(--green)" : "var(--red)" }}>
                                {group.totalR >= 0 ? "+" : ""}{group.totalR.toFixed(2)}R
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button
                                  onClick={() => toggleClosedTicker(group.ticker)}
                                  className="px-2 py-0.5 text-[10px] border border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[#555]"
                                >
                                  {isExpanded ? "HIDE" : "SHOW"}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="border-b border-[var(--border)]/50 bg-[#0e0e0e]">
                                <td colSpan={6} className="px-3 py-2">
                                  <table className="w-full text-xs" style={mono}>
                                    <thead>
                                      <tr className="text-[var(--dim)] border-b border-[var(--border)]/60">
                                        <th className="text-left px-2 py-1">EXIT</th>
                                        <th className="text-left px-2 py-1">ENTRY</th>
                                        <th className="text-right px-2 py-1">R</th>
                                        <th className="text-right px-2 py-1">P/L</th>
                                        <th className="text-right px-2 py-1">RUNNING P/L</th>
                                        <th className="text-right px-2 py-1">RUNNING R</th>
                                        <th className="text-center px-2 py-1">RESULT</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {group.history.map((h) => {
                                        const t = h.trade;
                                        const r = t.rMultiple ?? 0;
                                        const pl = h.pnl;
                                        const isWin = r > 0;
                                        const isFlat = r === 0;
                                        return (
                                          <tr key={t.id} className="border-b border-[var(--border)]/30">
                                            <td className="px-2 py-1 text-[var(--dim)]">{fmtDate(t.exitDate)}</td>
                                            <td className="px-2 py-1 text-[var(--dim)]">{fmtDate(t.entryDate)}</td>
                                            <td className="px-2 py-1 text-right" style={{ color: isFlat ? "var(--dim)" : isWin ? "var(--green)" : "var(--red)" }}>
                                              {r >= 0 ? "+" : ""}{r.toFixed(2)}R
                                            </td>
                                            <td className="px-2 py-1 text-right" style={{ color: pl != null && pl >= 0 ? "var(--green)" : "var(--red)" }}>
                                              {pl != null ? `${pl >= 0 ? "+" : ""}${c}${Math.abs(pl).toFixed(2)}` : "—"}
                                            </td>
                                            <td className="px-2 py-1 text-right" style={{ color: h.runningPnl >= 0 ? "var(--green)" : "var(--red)" }}>
                                              {h.runningPnl >= 0 ? "+" : ""}{c}{Math.abs(h.runningPnl).toFixed(2)}
                                            </td>
                                            <td className="px-2 py-1 text-right" style={{ color: h.runningR >= 0 ? "var(--green)" : "var(--red)" }}>
                                              {h.runningR >= 0 ? "+" : ""}{h.runningR.toFixed(2)}R
                                            </td>
                                            <td className="px-2 py-1 text-center">
                                              <Badge label={isFlat ? "B/E" : isWin ? "WIN" : "LOSS"} color={isFlat ? "var(--dim)" : isWin ? "var(--green)" : "var(--red)"} />
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              );
            }

            const allTrades = [...openTrades.map((t) => ({ ...t, _isOpen: true as const })), ...closedTrades.map((t) => ({ ...t, _isOpen: false as const }))];
            const filtered = tradeFilter === "OPEN"
              ? allTrades.filter((t) => t._isOpen)
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
                        {tradeFilter === "OPEN" ? "No open trades" : "No trades yet"}
                      </td>
                    </tr>
                  ) : (
                    sorted.map((t) => {
                      const r = t.rMultiple ?? 0;
                      const c = tickerCurrency(t.ticker);
                      if (t._isOpen) {
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
      <RunnerHistoryTable closedTrades={closedTrades} />

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
