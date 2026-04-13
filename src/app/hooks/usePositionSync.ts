"use client";

import { useReducer, useCallback, useEffect, useRef } from "react";
import type { SyncResult } from "../components/types";

// ── State ─────────────────────────────────────────────────────────────────────

interface PositionSyncState {
  syncingTradeId: string | null;
  syncingAll: boolean;
  syncProgress: string;
  syncData: Record<string, SyncResult>;
  lastSyncAt: string | null;
}

const initialState: PositionSyncState = {
  syncingTradeId: null,
  syncingAll: false,
  syncProgress: "",
  syncData: {},
  lastSyncAt: null,
};

// ── Actions ───────────────────────────────────────────────────────────────────

type Action =
  | { type: "SYNC_ONE_START"; tradeId: string }
  | { type: "SYNC_ONE_DONE"; tradeId: string; result: SyncResult }
  | { type: "SYNC_ONE_FAIL" }
  | { type: "SYNC_ALL_START" }
  | { type: "SYNC_ALL_DONE"; results: SyncResult[]; syncedAt: string }
  | { type: "SYNC_ALL_FAIL" };

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: PositionSyncState, action: Action): PositionSyncState {
  switch (action.type) {
    case "SYNC_ONE_START":
      return { ...state, syncingTradeId: action.tradeId };
    case "SYNC_ONE_DONE":
      return {
        ...state,
        syncingTradeId: null,
        syncData: { ...state.syncData, [action.tradeId]: action.result },
        lastSyncAt: new Date().toISOString(),
      };
    case "SYNC_ONE_FAIL":
      return { ...state, syncingTradeId: null };

    case "SYNC_ALL_START":
      return { ...state, syncingAll: true, syncProgress: "Syncing..." };
    case "SYNC_ALL_DONE": {
      const merged = { ...state.syncData };
      for (const r of action.results) merged[r.tradeId] = r;
      return {
        ...state,
        syncingAll: false,
        syncProgress: "",
        syncData: merged,
        lastSyncAt: action.syncedAt,
      };
    }
    case "SYNC_ALL_FAIL":
      return { ...state, syncingAll: false, syncProgress: "" };

    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePositionSync(
  refresh: () => void,
  triggerExitFlash: () => void,
  showError: (msg: string) => void,
  openTradeCount: number,
) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const syncedOnceRef = useRef(false);

  // Auto-sync on load (once, 5-min TTL)
  useEffect(() => {
    if (openTradeCount === 0) return;
    if (syncedOnceRef.current) return;
    if (state.lastSyncAt) {
      const elapsed = Date.now() - new Date(state.lastSyncAt).getTime();
      if (elapsed < 300_000) return;
    }
    if (state.syncingAll) return;
    syncedOnceRef.current = true;
    syncAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTradeCount]);

  const syncPosition = useCallback(
    async (tradeId: string) => {
      dispatch({ type: "SYNC_ONE_START", tradeId });
      try {
        const res = await fetch(`/api/positions/${tradeId}/sync`, { method: "POST" });
        if (res.ok) {
          const result: SyncResult = await res.json();
          result.tradeId = tradeId;
          dispatch({ type: "SYNC_ONE_DONE", tradeId, result });
          if (result.instruction?.type === "EXIT") triggerExitFlash();
          refresh();
        } else {
          dispatch({ type: "SYNC_ONE_FAIL" });
        }
      } catch {
        showError("Failed to sync position");
        dispatch({ type: "SYNC_ONE_FAIL" });
      }
    },
    [refresh, triggerExitFlash, showError],
  );

  async function syncAll() {
    dispatch({ type: "SYNC_ALL_START" });
    try {
      const res = await fetch("/api/positions/sync-all", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        const results: SyncResult[] = json.results ?? [];
        const syncedAt = json.syncedAt ?? new Date().toISOString();
        dispatch({ type: "SYNC_ALL_DONE", results, syncedAt });
        if (results.some((r) => r.instruction?.type === "EXIT")) triggerExitFlash();
        if (json.t212?.balance != null) {
          showError(`Synced — Balance updated to £${json.t212.balance.toFixed(2)}`);
        }
        refresh();
      } else {
        dispatch({ type: "SYNC_ALL_FAIL" });
      }
    } catch {
      showError("Failed to sync all positions");
      dispatch({ type: "SYNC_ALL_FAIL" });
    }
  }

  const syncAllPositions = useCallback(() => {
    syncAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, triggerExitFlash, showError]);

  return {
    syncingTradeId: state.syncingTradeId,
    syncingAll: state.syncingAll,
    syncProgress: state.syncProgress,
    syncData: state.syncData,
    lastSyncAt: state.lastSyncAt,
    syncPosition,
    syncAllPositions,
  };
}
