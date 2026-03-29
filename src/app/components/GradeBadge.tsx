"use client";
import React from "react";
import { mono } from "./helpers";

const gradeStyles: Record<string, { color: string; bg: string; border: string }> = {
  A: { color: "#00ff88", bg: "rgba(0,255,136,0.08)", border: "rgba(0,255,136,0.4)" },
  B: { color: "#66cc66", bg: "rgba(102,204,102,0.08)", border: "rgba(102,204,102,0.4)" },
  C: { color: "#f5a623", bg: "rgba(245,166,35,0.08)", border: "rgba(245,166,35,0.4)" },
  D: { color: "#ff4444", bg: "rgba(255,68,68,0.08)", border: "rgba(255,68,68,0.4)" },
};

export function GradeBadge({ grade, size = "md" }: { grade: string | null | undefined; size?: "sm" | "md" | "lg" }) {
  const g = grade?.toUpperCase() ?? "?";
  const s = gradeStyles[g] ?? { color: "var(--dim)", bg: "transparent", border: "var(--border)" };

  const sizeClass = size === "sm" ? "w-5 h-5 text-[10px]"
    : size === "lg" ? "w-8 h-8 text-base"
    : "w-6 h-6 text-xs";

  return (
    <span
      className={`inline-flex items-center justify-center font-bold rounded ${sizeClass}`}
      style={{ color: s.color, backgroundColor: s.bg, border: `1px solid ${s.border}`, ...mono }}
    >
      {g}
    </span>
  );
}
