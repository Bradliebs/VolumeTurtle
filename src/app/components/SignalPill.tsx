"use client";
import React from "react";
import { mono } from "./helpers";

const pillStyles: Record<string, { color: string; bg: string; border: string; label: string }> = {
  volume: { color: "#00d4ff", bg: "rgba(0,212,255,0.08)", border: "rgba(0,212,255,0.35)", label: "VOL" },
  momentum: { color: "#a855f7", bg: "rgba(168,85,247,0.08)", border: "rgba(168,85,247,0.35)", label: "MOM" },
  manual: { color: "#888", bg: "rgba(136,136,136,0.06)", border: "rgba(136,136,136,0.25)", label: "MAN" },
};

export function SignalPill({ source }: { source: string | null | undefined }) {
  const key = (source ?? "manual").toLowerCase();
  const s = pillStyles[key] ?? pillStyles.manual!;

  return (
    <span
      className="inline-flex items-center px-1.5 py-0 text-[9px] font-bold tracking-wider rounded-sm whitespace-nowrap"
      style={{ color: s.color, backgroundColor: s.bg, border: `1px solid ${s.border}`, ...mono }}
    >
      {s.label}
    </span>
  );
}
