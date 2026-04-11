import React from "react";
import type { EquityCurveData, SnapshotForSparkline } from "./types";
import { fmtMoney, mono } from "./helpers";
import { EquitySparkline } from "./EquitySparkline";

export function EquityCurvePanel({ data, snapshots }: { data: EquityCurveData | null; snapshots: SnapshotForSparkline[] }) {
  if (!data) return null;

  const isNormal = data.systemState === "NORMAL";
  const isCaution = data.systemState === "CAUTION";
  const isPause = data.systemState === "PAUSE";

  if (isNormal) {
    return (
      <section className="mb-6">
        <div className="border border-[var(--border)] bg-[var(--card)] p-4 flex flex-wrap items-center gap-4" style={mono}>
          <span className="text-xs font-semibold text-[var(--dim)] tracking-widest">EQUITY CURVE</span>
          <span className="text-sm text-[var(--dim)]">
            Balance <span className="text-white">{fmtMoney(data.currentBalance)}</span>
          </span>
          <span className="text-[var(--border)]">|</span>
          <span className="text-sm text-[var(--dim)]">
            Peak <span className="text-white">{fmtMoney(data.peakBalance)}</span>
          </span>
          <span className="text-[var(--border)]">|</span>
          <span className="text-sm text-[var(--dim)]">
            Drawdown <span className="text-white">{data.drawdownPct.toFixed(1)}%</span>
          </span>
          <span className="text-[var(--border)]">|</span>
          <span className="text-sm text-[var(--green)]">✅ NORMAL — full risk active</span>
          {data.earlyRecoveryActive && (
            <span className="text-sm text-[var(--green)] ml-1">↑ EARLY RECOVERY</span>
          )}
          {(data.consecutiveUpDays ?? 0) >= 2 && (
            <span className="text-[10px] text-[var(--green)] ml-1">({data.consecutiveUpDays} consecutive up days)</span>
          )}
          {snapshots.length >= 2 && (
            <div className="ml-auto">
              <EquitySparkline snapshots={snapshots} peak={data.peakBalance} ma20={data.equityMA20} />
            </div>
          )}
        </div>
      </section>
    );
  }

  const borderColor = isCaution ? "var(--amber)" : "var(--red)";
  const bgTint = isCaution ? "#1a1400" : "#1a0000";
  const icon = isCaution ? "⚠" : "🔴";
  const label = isCaution ? "CAUTION MODE ACTIVE" : "SYSTEM PAUSED — NO NEW ENTRIES";

  return (
    <section className="mb-6">
      <div className="p-4" style={{ border: `1px solid ${borderColor}`, background: bgTint, ...mono }}>
        <p className="text-sm font-bold mb-3" style={{ color: borderColor }}>
          {icon} {label}
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
          <span className="text-[var(--dim)]">Current balance</span>
          <span className="text-white">{fmtMoney(data.currentBalance)}</span>
          <span className="text-[var(--dim)]">Peak balance</span>
          <span className="text-white">{fmtMoney(data.peakBalance)}</span>
          <span className="text-[var(--dim)]">Drawdown</span>
          <span style={{ color: borderColor }}>{fmtMoney(data.drawdownAbs)} ({data.drawdownPct.toFixed(1)}% from peak)</span>
          {data.equityMA20 !== null && (
            <>
              <span className="text-[var(--dim)]">Equity MA20</span>
              <span className={data.aboveEquityMA ? "text-[var(--green)]" : "text-[var(--red)]"}>
                {fmtMoney(data.equityMA20)} — currently {data.aboveEquityMA ? "ABOVE" : "BELOW"} MA
              </span>
            </>
          )}
          {isCaution && (
            <>
              <span className="text-[var(--dim)]">Risk per trade</span>
              <span style={{ color: borderColor }}>{data.riskPctPerTrade.toFixed(1)}% (reduced from 2.0%)</span>
              <span className="text-[var(--dim)]">Max positions</span>
              <span style={{ color: borderColor }}>{data.maxPositions} (reduced from 5)</span>
            </>
          )}
          {isPause && (
            <>
              <span className="text-[var(--dim)]">Recovery needed</span>
              <span className="text-[var(--dim)]">{fmtMoney(data.drawdownAbs)} to return to NORMAL</span>
            </>
          )}
          {data.earlyRecoveryActive && (
            <>
              <span className="text-[var(--dim)]">Early recovery</span>
              <span className="text-[var(--green)]">↑ Active — {data.consecutiveUpDays} consecutive up days</span>
            </>
          )}
          {!data.earlyRecoveryActive && (data.consecutiveUpDays ?? 0) >= 2 && (
            <>
              <span className="text-[var(--dim)]">Recovery momentum</span>
              <span className="text-[var(--amber)]">↑ {data.consecutiveUpDays} consecutive up days{isPause ? ` — need drawdown < 18% for early CAUTION (currently ${data.drawdownPct.toFixed(1)}%)` : isCaution ? ` — need drawdown < 8% + above MA20 for early NORMAL (currently ${data.drawdownPct.toFixed(1)}%)` : ""}</span>
            </>
          )}
        </div>
        {snapshots.length >= 2 && (
          <EquitySparkline snapshots={snapshots} peak={data.peakBalance} ma20={data.equityMA20} />
        )}
      </div>
    </section>
  );
}
