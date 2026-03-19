"use client";

import React, { useState } from "react";
import { mono } from "./helpers";

const GRADES = [
  {
    grade: "A",
    color: "#00ff88",
    range: "0.75 – 1.00",
    label: "Strong",
    detail: "All four factors are firing — market regime, ticker trend, volume, and liquidity are all solid. High-confidence setup.",
  },
  {
    grade: "B",
    color: "var(--green)",
    range: "0.55 – 0.74",
    label: "Good",
    detail: "Most factors line up with minor weaknesses. Still a good trade — one factor may be lagging slightly.",
  },
  {
    grade: "C",
    color: "var(--amber)",
    range: "0.35 – 0.54",
    label: "Marginal",
    detail: "Mixed conditions. The signal fired but the setup has real weaknesses. Consider skipping unless you have strong conviction.",
  },
  {
    grade: "D",
    color: "var(--red)",
    range: "0.00 – 0.34",
    label: "Weak",
    detail: "Multiple factors are against you — high risk of a false signal. Best to pass on this one.",
  },
] as const;

const FACTORS = [
  { name: "Regime", weight: "40%", desc: "Is the broader market (QQQ) in an uptrend? Is volatility (VIX) calm?" },
  { name: "Trend", weight: "30%", desc: "Is the specific stock trading above its 50-day moving average?" },
  { name: "Volume", weight: "20%", desc: "How strong is the volume spike? Bigger spikes score higher." },
  { name: "Liquidity", weight: "10%", desc: "Is there enough daily trading volume so you can get in and out easily?" },
] as const;

export function GradeLegend() {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4" style={mono}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-[10px] text-[var(--dim)] hover:text-white transition-colors"
      >
        <span className="tracking-widest">WHAT DO THE GRADES MEAN?</span>
        <span className="text-[var(--dim)]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="mt-3 border border-[var(--border)] bg-[#0a0a0a] p-4 text-xs animate-fade-in">
          {/* Grade scale */}
          <p className="text-[var(--dim)] font-semibold tracking-widest mb-3 text-[10px]">
            SIGNAL GRADE SCALE
          </p>

          <div className="space-y-2 mb-4">
            {GRADES.map((g) => (
              <div key={g.grade} className="flex gap-3 items-start">
                <span
                  className="inline-block w-6 text-center font-bold text-sm shrink-0 border rounded px-1"
                  style={{ color: g.color, borderColor: g.color }}
                >
                  {g.grade}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold" style={{ color: g.color }}>{g.label}</span>
                    <span className="text-[var(--dim)] text-[10px]">score {g.range}</span>
                  </div>
                  <p className="text-[var(--dim)] text-[10px] mt-0.5 leading-relaxed">{g.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {/* What makes up the score */}
          <p className="text-[var(--dim)] font-semibold tracking-widest mb-2 text-[10px] border-t border-[var(--border)] pt-3">
            WHAT MAKES UP THE SCORE
          </p>
          <p className="text-[var(--dim)] text-[10px] mb-3 leading-relaxed">
            Each signal gets a composite score from 0.00 to 1.00 by combining four factors:
          </p>

          <div className="space-y-1.5">
            {FACTORS.map((f) => (
              <div key={f.name} className="flex gap-3 items-start">
                <span className="text-white font-semibold w-16 shrink-0">
                  {f.name}
                  <span className="text-[var(--dim)] font-normal ml-1">{f.weight}</span>
                </span>
                <span className="text-[var(--dim)] text-[10px] leading-relaxed">{f.desc}</span>
              </div>
            ))}
          </div>

          <p className="text-[var(--dim)] text-[10px] mt-3 pt-2 border-t border-[var(--border)] leading-relaxed">
            <span className="text-white">Tip:</span> Focus on A and B grades when starting out. C grades
            can work but require experience to filter the good from the bad.
          </p>
        </div>
      )}
    </div>
  );
}
