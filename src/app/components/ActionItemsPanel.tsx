"use client";

import React from "react";
import type { ActionItem } from "./types";
import { mono, fmtPrice } from "./helpers";

export interface ActionItemsPanelProps {
  actionItems: ActionItem[];
  onMarkDone: (stopHistoryId: string) => void;
  onSync: (tradeId: string) => void;
  onPushStop: (tradeId: string) => void;
  syncingTradeId: string | null;
  pushingStopTradeId: string | null;
}

function actionButton(
  item: ActionItem,
  onMarkDone: (id: string) => void,
  onSync: (id: string) => void,
  onPushStop: (id: string) => void,
  syncingTradeId: string | null,
  pushingStopTradeId: string | null,
) {
  if (item.type === "sync" || item.type === "SYNC") {
    const isSyncing = syncingTradeId === item.stopHistoryId;
    return (
      <button
        onClick={() => item.stopHistoryId && onSync(item.stopHistoryId)}
        disabled={isSyncing}
        className="px-2 py-0.5 text-xs border border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[var(--green)] transition-colors disabled:opacity-40"
        style={mono}
      >
        {isSyncing ? "Syncing…" : "Sync"}
      </button>
    );
  }

  if (item.type === "push_stop" || item.type === "PUSH_STOP") {
    const isPushing = pushingStopTradeId === item.stopHistoryId;
    return (
      <button
        onClick={() => item.stopHistoryId && onPushStop(item.stopHistoryId)}
        disabled={isPushing}
        className="px-2 py-0.5 text-xs border border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black transition-colors disabled:opacity-40"
        style={mono}
      >
        {isPushing ? "Pushing…" : "Push Stop"}
      </button>
    );
  }

  // Default: mark done
  return (
    <button
      onClick={() => item.stopHistoryId && onMarkDone(item.stopHistoryId)}
      className="px-2 py-0.5 text-xs border border-[var(--border)] text-[var(--dim)] hover:text-white hover:border-[var(--green)] transition-colors"
      style={mono}
    >
      Mark Done
    </button>
  );
}

export function ActionItemsPanel({
  actionItems,
  onMarkDone,
  onSync,
  onPushStop,
  syncingTradeId,
  pushingStopTradeId,
}: ActionItemsPanelProps) {
  if (actionItems.length === 0) return null;

  return (
    <section className="mb-6">
      <div
        className="text-xs font-semibold tracking-widest mb-2"
        style={{ ...mono, color: "var(--amber)" }}
      >
        ⚠ ACTION REQUIRED ({actionItems.length})
      </div>
      <div className="border border-[var(--amber)] bg-[var(--card)]">
        {actionItems.map((item, i) => (
          <div
            key={item.stopHistoryId ?? `action-${i}`}
            className="flex items-center justify-between gap-4 px-4 py-2 border-b border-[var(--border)] last:border-b-0"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className="text-xs font-semibold whitespace-nowrap"
                style={{ ...mono, color: "var(--amber)" }}
              >
                {item.ticker}
              </span>
              <span className="text-xs text-[var(--dim)] truncate" style={mono}>
                {item.message}
              </span>
              {item.urgency === "high" && (
                <span
                  className="px-1.5 py-0.5 text-[10px] border"
                  style={{
                    ...mono,
                    color: "var(--amber)",
                    borderColor: "var(--amber)",
                  }}
                >
                  URGENT
                </span>
              )}
            </div>
            <div className="flex-shrink-0">
              {actionButton(item, onMarkDone, onSync, onPushStop, syncingTradeId, pushingStopTradeId)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
