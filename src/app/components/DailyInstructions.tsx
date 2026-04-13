"use client";

import React from "react";
import type { Instruction, SyncResult, TradeWithHistory } from "./types";
import { mono, fmtDate } from "./helpers";

export interface DailyInstructionsProps {
  instructions: Instruction[];
  syncData: Record<string, SyncResult>;
  t212Prices: Record<string, { currentPrice: number; ppl: number; stopLoss: number | null }> | undefined;
  syncingTradeId: string | null;
  pushingStopTradeId: string | null;
  exitFlash: boolean;
  openTrades: TradeWithHistory[];
  onSync: (tradeId: string) => void;
  onPushStop: (tradeId: string) => void;
  onStartExit: (tradeId: string) => void;
  onMarkDone: (stopHistoryId: string) => void;
}

export function DailyInstructions({
  instructions,
  pushingStopTradeId,
  exitFlash,
  openTrades,
  onPushStop,
}: DailyInstructionsProps) {
  return (
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
                                onClick={() => onPushStop(matchTrade.id)}
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
                                onClick={() => onPushStop(matchTrade.id)}
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
  );
}
