"use client";
import React from "react";
import { mono } from "./helpers";

interface MomentumSummaryData {
  topSector: string | null;
  topSectorScore: number | null;
  signalCount: number;
  nearMissCount: number;
  gradeBreakdown: { A: number; B: number; C: number; D: number };
  convergenceCount: number;
}

export function MomentumSummaryPanel({ data }: { data: MomentumSummaryData | null }) {
  if (!data) return null;

  const hasSignals = data.signalCount > 0 || data.nearMissCount > 0;
  if (!hasSignals && !data.topSector) return null;

  const gb = data.gradeBreakdown;

  return (
    <section className="mb-6 border border-[var(--border)] bg-[var(--card)] p-4" style={mono}>
      <h3 className="text-xs font-semibold text-[var(--dim)] tracking-widest mb-3">
        MOMENTUM ENGINE
      </h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <span className="text-[var(--dim)]">Top sector</span>
        <span className="text-white font-semibold">
          {data.topSector ?? "—"}
          {data.topSectorScore != null && (
            <span className="text-[var(--dim)] ml-1">({data.topSectorScore.toFixed(2)})</span>
          )}
        </span>
        <span className="text-[var(--dim)]">Signals</span>
        <span className="text-white">{data.signalCount}</span>
        <span className="text-[var(--dim)]">Grades</span>
        <span className="flex items-center gap-1.5">
          {gb.A > 0 && <span style={{ color: "#00ff88" }}>{gb.A}A</span>}
          {gb.B > 0 && <span style={{ color: "#66cc66" }}>{gb.B}B</span>}
          {gb.C > 0 && <span style={{ color: "var(--amber)" }}>{gb.C}C</span>}
          {gb.D > 0 && <span style={{ color: "var(--red)" }}>{gb.D}D</span>}
          {gb.A + gb.B + gb.C + gb.D === 0 && <span className="text-[var(--dim)]">—</span>}
        </span>
        <span className="text-[var(--dim)]">Near misses</span>
        <span className="text-[var(--dim)]">{data.nearMissCount}</span>
      </div>

      {data.convergenceCount > 0 && (
        <div className="mt-3 px-3 py-2 border border-cyan-500/40 bg-cyan-950/20 text-xs">
          <span className="text-cyan-400 font-bold">
            ⚡ CONVERGENCE — {data.convergenceCount} ticker{data.convergenceCount > 1 ? "s" : ""} flagged by both engines
          </span>
        </div>
      )}
    </section>
  );
}
