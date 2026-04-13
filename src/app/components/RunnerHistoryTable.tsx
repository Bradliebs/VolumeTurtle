"use client";

import React from "react";
import type { Trade } from "./types";
import { mono, fmtDate, tickerCurrency } from "./helpers";
import { Badge } from "./Badge";

export interface RunnerHistoryTableProps {
  closedTrades: Trade[];
}

export function RunnerHistoryTable({ closedTrades }: RunnerHistoryTableProps) {
  const runnerTrades = closedTrades.filter((t) => t.isRunner === true);
  if (runnerTrades.length === 0) return null;

  const avgHoldDays = runnerTrades.reduce((sum, t) => {
    const hold = t.exitDate && t.entryDate
      ? Math.floor((new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    return sum + hold;
  }, 0) / runnerTrades.length;

  const avgPeak = runnerTrades.reduce((s, t) => s + (t.runnerPeakProfit ?? 0), 0) / runnerTrades.length;
  const withCapture = runnerTrades.filter((t) => t.runnerCaptureRate != null);
  const avgCapture = withCapture.reduce((s, t) => s + (t.runnerCaptureRate ?? 0), 0) / (withCapture.length || 1);
  const avgExitProfit = runnerTrades.reduce((s, t) => s + (t.runnerExitProfit ?? 0), 0) / runnerTrades.length;

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
            {runnerTrades.map((t) => {
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
        {runnerTrades.length >= 5 && (
          <div className="px-3 py-2 text-[10px] text-[var(--dim)] border-t border-[var(--border)]" style={mono}>
            Runners: {runnerTrades.length} closed · Avg hold: {avgHoldDays.toFixed(0)}d · Avg peak: +{(avgPeak * 100).toFixed(1)}% · Avg capture: {(avgCapture * 100).toFixed(0)}% · Avg exit profit: {avgExitProfit >= 0 ? "+" : ""}{(avgExitProfit * 100).toFixed(1)}%
          </div>
        )}
      </div>
    </section>
  );
}
