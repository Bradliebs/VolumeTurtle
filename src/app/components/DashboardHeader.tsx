"use client";

import React from "react";
import Link from "next/link";
import { mono } from "./helpers";
import { AlertPanel } from "./AlertPanel";

export interface DashboardHeaderProps {
  balance: number;
  editingBalance: boolean;
  balanceInput: string;
  stopAlignmentState: "none" | "unknown" | "needs_update" | "aligned";
  unprotectedCount: number;
  syncingAll: boolean;
  lastSyncAt: string | null;
  refreshing: boolean;
  onStartBalanceEdit: (current: number) => void;
  onCancelBalanceEdit: () => void;
  onSetBalanceInput: (value: string) => void;
  onUpdateBalance: () => void;
  onSyncAll: () => void;
  ratcheting: boolean;
  ratchetMsg: string | null;
  onRatchet: () => void;
  hasStopAction: boolean;
}

const NAV_LINKS = [
  { href: "/", label: "DASHBOARD" },
  { href: "/journal", label: "JOURNAL" },
  { href: "/momentum", label: "MOMENTUM" },
  { href: "/watchlist", label: "WATCHLIST" },
  { href: "/execution", label: "PENDING" },
  { href: "/settings", label: "SETTINGS" },
];

export function DashboardHeader({
  balance,
  editingBalance,
  balanceInput,
  stopAlignmentState,
  unprotectedCount,
  syncingAll,
  lastSyncAt,
  refreshing,
  onStartBalanceEdit,
  onCancelBalanceEdit,
  onSetBalanceInput,
  onUpdateBalance,
  onSyncAll,
  ratcheting,
  ratchetMsg,
  onRatchet,
  hasStopAction,
}: DashboardHeaderProps) {
  const alignmentColor =
    stopAlignmentState === "aligned"
      ? "var(--green)"
      : stopAlignmentState === "needs_update"
        ? "var(--amber)"
        : "var(--dim)";

  const alignmentLabel =
    stopAlignmentState === "aligned"
      ? "STOPS ALIGNED"
      : stopAlignmentState === "needs_update"
        ? "STOPS NEED UPDATE"
        : stopAlignmentState === "unknown"
          ? "STOPS UNKNOWN"
          : null;

  return (
    <header className="mb-4">
      {/* Nav row */}
      <div className="flex items-center gap-4 mb-3 flex-wrap">
        <nav className="flex items-center gap-3 text-xs tracking-widest" style={mono}>
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-[var(--dim)] hover:text-white transition-colors"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <span
          className="px-2 py-0.5 text-[10px] tracking-wider border"
          style={{
            ...mono,
            color: "var(--green)",
            borderColor: "var(--green)",
            background: "rgba(0,255,0,0.05)",
          }}
        >
          LIVE
        </span>

        {alignmentLabel && (
          <span
            className="px-2 py-0.5 text-[10px] tracking-wider border"
            style={{ ...mono, color: alignmentColor, borderColor: alignmentColor }}
          >
            {alignmentLabel}
          </span>
        )}

        {unprotectedCount > 0 && (
          <span
            className="px-2 py-0.5 text-[10px] tracking-wider border"
            style={{ ...mono, color: "var(--amber)", borderColor: "var(--amber)" }}
          >
            {unprotectedCount} UNPROTECTED
          </span>
        )}
      </div>

      {/* Balance + controls row */}
      <div className="flex items-center gap-4 flex-wrap">
        {editingBalance ? (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={balanceInput}
              onChange={(e) => onSetBalanceInput(e.target.value)}
              className="w-28 px-2 py-1 text-sm bg-black border border-[var(--border)] text-white"
              style={mono}
              onKeyDown={(e) => {
                if (e.key === "Enter") onUpdateBalance();
                if (e.key === "Escape") onCancelBalanceEdit();
              }}
            />
            <button
              onClick={onUpdateBalance}
              className="px-2 py-1 text-xs border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors"
              style={mono}
            >
              Save
            </button>
            <button
              onClick={onCancelBalanceEdit}
              className="px-2 py-1 text-xs border border-[var(--border)] text-[var(--dim)] hover:text-white transition-colors"
              style={mono}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => onStartBalanceEdit(balance)}
            className="text-sm text-[var(--dim)] hover:text-white transition-colors"
            style={mono}
            title="Click to edit balance"
          >
            BAL £{balance.toLocaleString("en-GB", { minimumFractionDigits: 0 })}
          </button>
        )}

        <button
          onClick={onSyncAll}
          disabled={syncingAll || refreshing}
          className="px-3 py-1 text-xs border border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[var(--green)] transition-colors disabled:opacity-40"
          style={mono}
        >
          {syncingAll ? "Syncing…" : "⟳ Sync All"}
        </button>

        {hasStopAction && (
          <button
            onClick={onRatchet}
            disabled={ratcheting}
            className="px-3 py-1 text-xs border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors disabled:opacity-40"
            style={mono}
          >
            {ratcheting ? "Ratcheting…" : "⬆ Ratchet Stops"}
          </button>
        )}

        {ratchetMsg && (
          <span className="text-xs text-[var(--dim)]" style={mono}>
            {ratchetMsg}
          </span>
        )}

        {lastSyncAt && (
          <span className="text-xs text-[#444]" style={mono}>
            Last sync {new Date(lastSyncAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      {/* Alert panel */}
      <div className="mt-2">
        <AlertPanel />
      </div>
    </header>
  );
}
