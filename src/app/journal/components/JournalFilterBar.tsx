"use client";

import type { SignalSourceFilter } from "../types";

const FILTERS: { label: string; value: SignalSourceFilter }[] = [
  { label: "All", value: "all" },
  { label: "Volume", value: "volume" },
  { label: "Momentum", value: "momentum" },
  { label: "Manual", value: "manual" },
];

interface Props {
  active: SignalSourceFilter;
  onChange: (v: SignalSourceFilter) => void;
}

export function JournalFilterBar({ active, onChange }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          onClick={() => onChange(f.value)}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all ${
            active === f.value
              ? "bg-[var(--green)] text-black"
              : "bg-[var(--card)] text-[var(--dim)] border border-[var(--border)] hover:text-white hover:border-[var(--dim)]"
          }`}
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
