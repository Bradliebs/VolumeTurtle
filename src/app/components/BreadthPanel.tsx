import React from "react";
import type { BreadthData } from "./types";
import { mono } from "./helpers";

function StatTile({ label, value, threshold }: { label: string; value: number; threshold: [number, number] }) {
  const color =
    value >= threshold[0] ? "var(--green)" :
    value >= threshold[1] ? "var(--amber)" :
    "var(--red)";
  return (
    <div className="flex flex-col items-center p-3 border border-[var(--border)] bg-[#0a0a0a]">
      <span className="text-[10px] text-[var(--dim)] tracking-wider mb-1">{label}</span>
      <span className="text-lg font-bold" style={{ color }}>{value.toFixed(0)}%</span>
    </div>
  );
}

export function BreadthPanel({ breadth }: { breadth: BreadthData | null }) {
  if (!breadth) return null;

  const { breadthScore, breadthSignal, breadthTrend, above50MA, above200MA, newHighLowRatio, advanceDecline, warning, history } = breadth;

  // Signal color + label
  let signalColor = "var(--green)";
  if (breadthSignal === "NEUTRAL") signalColor = "var(--amber)";
  else if (breadthSignal === "WEAK") signalColor = "var(--red)";
  else if (breadthSignal === "DETERIORATING") signalColor = "var(--red)";

  // Trend icon
  const trendIcon = breadthTrend === "IMPROVING" ? "↑" : breadthTrend === "DECLINING" ? "↓" : "→";
  const trendColor = breadthTrend === "IMPROVING" ? "var(--green)" : breadthTrend === "DECLINING" ? "var(--red)" : "var(--dim)";

  // Score bar width (0-100)
  const barWidth = Math.max(0, Math.min(100, breadthScore));

  // Sparkline from history
  const sparkline = history ?? [];

  return (
    <section className="mb-6 border border-[var(--border)] bg-[var(--card)] p-4" style={mono}>
      <p className="text-xs font-semibold text-[var(--dim)] tracking-widest mb-3">
        MARKET BREADTH
      </p>

      {/* Four stat tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <StatTile label="ABOVE 50MA" value={above50MA} threshold={[60, 40]} />
        <StatTile label="ABOVE 200MA" value={above200MA} threshold={[60, 40]} />
        <StatTile label="HI/LO RATIO" value={newHighLowRatio} threshold={[60, 30]} />
        <StatTile label="ADV/DEC" value={advanceDecline} threshold={[55, 45]} />
      </div>

      {/* Score bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[var(--dim)]">BREADTH SCORE</span>
          <span className="text-xs" style={{ color: trendColor }}>{trendIcon} {breadthTrend}</span>
        </div>
        <div className="relative h-5 bg-[#111] border border-[var(--border)] overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 transition-all duration-500"
            style={{
              width: `${barWidth}%`,
              background: signalColor,
              opacity: 0.3,
            }}
          />
          {/* Reference lines */}
          <div className="absolute inset-y-0 left-[60%] w-px bg-[var(--green)] opacity-20" />
          <div className="absolute inset-y-0 left-[30%] w-px bg-[var(--red)] opacity-20" />
          {/* Score label */}
          <div className="absolute inset-0 flex items-center justify-center">
            <span
              className={`text-xs font-bold ${breadthSignal === "DETERIORATING" ? "animate-pulse" : ""}`}
              style={{ color: signalColor }}
            >
              {breadthScore.toFixed(0)} — {breadthSignal}
            </span>
          </div>
        </div>
      </div>

      {/* Sparkline (30-day history) */}
      {sparkline.length >= 2 && (
        <div className="mb-3">
          <span className="text-[10px] text-[var(--dim)] tracking-wider">30-SCAN TREND</span>
          <svg viewBox="0 0 300 40" className="w-full h-8 mt-1" preserveAspectRatio="none">
            {/* STRONG threshold line */}
            <line x1="0" y1={40 - (60 / 100) * 40} x2="300" y2={40 - (60 / 100) * 40} stroke="var(--green)" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.3" />
            {/* DETERIORATING threshold line */}
            <line x1="0" y1={40 - (30 / 100) * 40} x2="300" y2={40 - (30 / 100) * 40} stroke="var(--red)" strokeWidth="0.5" strokeDasharray="4 4" opacity="0.3" />
            {/* Score line */}
            <polyline
              fill="none"
              stroke={signalColor}
              strokeWidth="1.5"
              points={sparkline
                .map((p, i) => {
                  const x = (i / Math.max(sparkline.length - 1, 1)) * 300;
                  const y = 40 - ((p.score ?? 0) / 100) * 40;
                  return `${x},${y}`;
                })
                .join(" ")}
            />
          </svg>
        </div>
      )}

      {/* Warning */}
      {warning && (
        <div
          className="text-xs px-2 py-1.5 border-l-2"
          style={{
            color: above50MA < 30 ? "var(--red)" : "var(--amber)",
            borderColor: above50MA < 30 ? "var(--red)" : "var(--amber)",
            background: above50MA < 30 ? "rgba(255,50,50,0.06)" : "rgba(255,180,0,0.06)",
          }}
        >
          ⚠ {warning}
        </div>
      )}
    </section>
  );
}
