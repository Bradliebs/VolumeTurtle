"use client";

import { useReducer, useEffect, useCallback, useRef } from "react";
import type {
  DashboardData,
  ScanResponse,
  SignalFired,
  SyncResult,
} from "../components/types";

// ── State ─────────────────────────────────────────────────────────────────────

interface DashboardState {
  data: DashboardData | null;
  loading: boolean;
  refreshing: boolean;
  scanRunning: boolean;
  scanResult: ScanResponse | null;
  scanError: string | null;
  showConfirm: boolean;
  placingTicker: string | null;
  exitingTradeId: string | null;
  exitPrice: string;
  editingBalance: boolean;
  balanceInput: string;
  expandedTradeId: string | null;
  syncingTradeId: string | null;
  syncingAll: boolean;
  syncProgress: string;
  syncData: Record<string, SyncResult>;
  lastSyncAt: string | null;
  pushingStopTradeId: string | null;
  pushingStopTicker: string | null;
  pendingStopPush: { tradeId: string; ticker: string; currentStop: number; newStop: number; t212Stop: number | null; currency: string } | null;
  importingTicker: string | null;
  importingAll: boolean;
  importProgress: string;
  exitFlash: boolean;
  errorMsg: string | null;
}

const initialState: DashboardState = {
  data: null,
  loading: true,
  refreshing: false,
  scanRunning: false,
  scanResult: null,
  scanError: null,
  showConfirm: false,
  placingTicker: null,
  exitingTradeId: null,
  exitPrice: "",
  editingBalance: false,
  balanceInput: "",
  expandedTradeId: null,
  syncingTradeId: null,
  syncingAll: false,
  syncProgress: "",
  syncData: {},
  lastSyncAt: null,
  pushingStopTradeId: null,
  pushingStopTicker: null,
  pendingStopPush: null as { tradeId: string; ticker: string; currentStop: number; newStop: number; t212Stop: number | null; currency: string } | null,
  importingTicker: null,
  importingAll: false,
  importProgress: "",
  exitFlash: false,
  errorMsg: null,
};

// ── Actions ───────────────────────────────────────────────────────────────────

type Action =
  | { type: "FETCH_START"; refresh: boolean }
  | { type: "FETCH_SUCCESS"; data: DashboardData }
  | { type: "FETCH_DONE" }
  | { type: "SCAN_START" }
  | { type: "SCAN_SUCCESS"; result: ScanResponse }
  | { type: "SCAN_ERROR"; error: string }
  | { type: "SHOW_CONFIRM" }
  | { type: "HIDE_CONFIRM" }
  | { type: "SET_PLACING"; ticker: string | null }
  | { type: "START_EXIT"; tradeId: string }
  | { type: "CANCEL_EXIT" }
  | { type: "SET_EXIT_PRICE"; price: string }
  | { type: "START_BALANCE_EDIT"; current: string }
  | { type: "CANCEL_BALANCE_EDIT" }
  | { type: "SET_BALANCE_INPUT"; value: string }
  | { type: "BALANCE_UPDATED" }
  | { type: "TOGGLE_EXPAND"; tradeId: string }
  | { type: "SYNC_ONE_START"; tradeId: string }
  | { type: "SYNC_ONE_DONE"; tradeId: string; result: SyncResult }
  | { type: "SYNC_ONE_FAIL" }
  | { type: "SYNC_ALL_START" }
  | { type: "SYNC_ALL_DONE"; results: SyncResult[]; syncedAt: string }
  | { type: "SYNC_ALL_FAIL" }
  | { type: "T212_STOP_START"; tradeId: string }
  | { type: "T212_STOP_DONE"; tradeId: string }
  | { type: "T212_STOP_FAIL" }
  | { type: "T212_STOP_CONFIRM"; payload: { tradeId: string; ticker: string; currentStop: number; newStop: number; t212Stop: number | null; currency: string } }
  | { type: "T212_STOP_CANCEL" }
  | { type: "T212_TICKER_STOP_START"; ticker: string }
  | { type: "T212_TICKER_STOP_DONE" }
  | { type: "T212_TICKER_STOP_FAIL" }
  | { type: "IMPORT_ONE_START"; ticker: string }
  | { type: "IMPORT_ONE_DONE" }
  | { type: "IMPORT_ONE_FAIL" }
  | { type: "IMPORT_ALL_START" }
  | { type: "IMPORT_ALL_PROGRESS"; msg: string }
  | { type: "IMPORT_ALL_DONE" }
  | { type: "IMPORT_ALL_FAIL" }
  | { type: "EXIT_FLASH"; active: boolean }
  | { type: "SET_ERROR"; msg: string }
  | { type: "CLEAR_ERROR" };

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: DashboardState, action: Action): DashboardState {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, refreshing: action.refresh };
    case "FETCH_SUCCESS":
      return { ...state, data: action.data, loading: false, refreshing: false };
    case "FETCH_DONE":
      return { ...state, loading: false, refreshing: false };

    case "SCAN_START":
      return { ...state, scanRunning: true, scanResult: null, scanError: null };
    case "SCAN_SUCCESS":
      return { ...state, scanRunning: false, scanResult: action.result };
    case "SCAN_ERROR":
      return { ...state, scanRunning: false, scanError: action.error };
    case "SHOW_CONFIRM":
      return { ...state, showConfirm: true };
    case "HIDE_CONFIRM":
      return { ...state, showConfirm: false };

    case "SET_PLACING":
      return { ...state, placingTicker: action.ticker };
    case "START_EXIT":
      return { ...state, exitingTradeId: action.tradeId };
    case "CANCEL_EXIT":
      return { ...state, exitingTradeId: null, exitPrice: "" };
    case "SET_EXIT_PRICE":
      return { ...state, exitPrice: action.price };

    case "START_BALANCE_EDIT":
      return { ...state, editingBalance: true, balanceInput: action.current };
    case "CANCEL_BALANCE_EDIT":
      return { ...state, editingBalance: false, balanceInput: "" };
    case "SET_BALANCE_INPUT":
      return { ...state, balanceInput: action.value };
    case "BALANCE_UPDATED":
      return { ...state, editingBalance: false, balanceInput: "" };

    case "TOGGLE_EXPAND":
      return {
        ...state,
        expandedTradeId:
          state.expandedTradeId === action.tradeId ? null : action.tradeId,
      };

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

    case "T212_STOP_START":
      return { ...state, pushingStopTradeId: action.tradeId, pendingStopPush: null };
    case "T212_STOP_DONE":
      return { ...state, pushingStopTradeId: null };
    case "T212_STOP_FAIL":
      return { ...state, pushingStopTradeId: null };
    case "T212_STOP_CONFIRM":
      return { ...state, pendingStopPush: action.payload };
    case "T212_STOP_CANCEL":
      return { ...state, pendingStopPush: null };

    case "T212_TICKER_STOP_START":
      return { ...state, pushingStopTicker: action.ticker };
    case "T212_TICKER_STOP_DONE":
      return { ...state, pushingStopTicker: null };
    case "T212_TICKER_STOP_FAIL":
      return { ...state, pushingStopTicker: null };

    case "IMPORT_ONE_START":
      return { ...state, importingTicker: action.ticker };
    case "IMPORT_ONE_DONE":
      return { ...state, importingTicker: null };
    case "IMPORT_ONE_FAIL":
      return { ...state, importingTicker: null };

    case "IMPORT_ALL_START":
      return { ...state, importingAll: true, importProgress: "Starting import..." };
    case "IMPORT_ALL_PROGRESS":
      return { ...state, importProgress: action.msg };
    case "IMPORT_ALL_DONE":
      return { ...state, importingAll: false, importProgress: "" };
    case "IMPORT_ALL_FAIL":
      return { ...state, importingAll: false, importProgress: "" };

    case "EXIT_FLASH":
      return { ...state, exitFlash: action.active };
    case "SET_ERROR":
      return { ...state, errorMsg: action.msg };
    case "CLEAR_ERROR":
      return { ...state, errorMsg: null };

    default:
      return state;
  }
}

// ── Flash + scroll helper ─────────────────────────────────────────────────────

function triggerExitFlash(dispatch: React.Dispatch<Action>) {
  dispatch({ type: "EXIT_FLASH", active: true });
  setTimeout(() => dispatch({ type: "EXIT_FLASH", active: false }), 1500);
  document.getElementById("daily-instructions")?.scrollIntoView({ behavior: "smooth" });
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDashboard() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const syncedOnceRef = useRef(false);

  const showError = useCallback((msg: string) => {
    dispatch({ type: "SET_ERROR", msg });
    setTimeout(() => dispatch({ type: "CLEAR_ERROR" }), 6000);
  }, []);

  const fetchDashboard = useCallback(
    async (isRefresh = false) => {
      dispatch({ type: "FETCH_START", refresh: isRefresh });
      try {
        const res = await fetch("/api/dashboard");
        if (res.ok) {
          dispatch({ type: "FETCH_SUCCESS", data: await res.json() });
        } else {
          dispatch({ type: "FETCH_DONE" });
        }
      } catch {
        showError("Failed to load dashboard");
        dispatch({ type: "FETCH_DONE" });
      }
    },
    [showError],
  );

  // Periodic refresh
  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(() => fetchDashboard(true), 60_000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // Auto-sync on load (once)
  useEffect(() => {
    if (!state.data || state.data.openTrades.length === 0) return;
    if (syncedOnceRef.current) return;
    if (state.lastSyncAt) {
      const elapsed = Date.now() - new Date(state.lastSyncAt).getTime();
      if (elapsed < 300_000) return;  // 5 minute TTL
    }
    if (state.syncingAll) return;
    syncedOnceRef.current = true;
    syncAllPositions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data?.openTrades.length]);

  // ── Async actions ─────────────────────────────────────────────────────────

  async function syncPosition(tradeId: string) {
    dispatch({ type: "SYNC_ONE_START", tradeId });
    try {
      const res = await fetch(`/api/positions/${tradeId}/sync`, { method: "POST" });
      if (res.ok) {
        const result: SyncResult = await res.json();
        result.tradeId = tradeId;
        dispatch({ type: "SYNC_ONE_DONE", tradeId, result });
        if (result.instruction?.type === "EXIT") triggerExitFlash(dispatch);
        fetchDashboard(true);
      } else {
        dispatch({ type: "SYNC_ONE_FAIL" });
      }
    } catch {
      showError("Failed to sync position");
      dispatch({ type: "SYNC_ONE_FAIL" });
    }
  }

  async function syncAllPositions() {
    dispatch({ type: "SYNC_ALL_START" });
    try {
      const res = await fetch("/api/positions/sync-all", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        const results: SyncResult[] = json.results ?? [];
        const syncedAt = json.syncedAt ?? new Date().toISOString();
        dispatch({ type: "SYNC_ALL_DONE", results, syncedAt });
        if (results.some((r) => r.instruction?.type === "EXIT")) triggerExitFlash(dispatch);
        fetchDashboard(true);
      } else {
        dispatch({ type: "SYNC_ALL_FAIL" });
      }
    } catch {
      showError("Failed to sync all positions");
      dispatch({ type: "SYNC_ALL_FAIL" });
    }
  }

  async function runScan(dry: boolean) {
    dispatch({ type: "SCAN_START" });
    try {
      const res = await fetch(`/api/scan?dry=${dry}`);
      const json = await res.json();
      if (json.error) {
        dispatch({ type: "SCAN_ERROR", error: json.error });
      } else {
        dispatch({ type: "SCAN_SUCCESS", result: json });
        fetchDashboard(true);
      }
    } catch (err) {
      dispatch({
        type: "SCAN_ERROR",
        error: err instanceof Error ? err.message : "Scan failed",
      });
    }
  }

  async function markPlaced(signal: SignalFired) {
    dispatch({ type: "SET_PLACING", ticker: signal.ticker });
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: signal.ticker,
          suggestedEntry: signal.suggestedEntry,
          hardStop: signal.hardStop,
          riskPerShare: signal.riskPerShare,
          volumeRatio: signal.volumeRatio,
          rangePosition: signal.rangePosition,
          atr20: signal.atr20,
          shares: signal.positionSize?.shares ?? 0,
        }),
      });
      if (res.ok) fetchDashboard(true);
    } catch {
      showError("Failed to place trade");
    } finally {
      dispatch({ type: "SET_PLACING", ticker: null });
    }
  }

  async function markExited(tradeId: string) {
    const price = parseFloat(state.exitPrice);
    if (isNaN(price) || price <= 0) return;
    try {
      const res = await fetch(`/api/trades/${tradeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exitPrice: price }),
      });
      if (res.ok) {
        dispatch({ type: "CANCEL_EXIT" });
        fetchDashboard(true);
      }
    } catch {
      showError("Failed to record exit");
    }
  }

  async function updateBalance() {
    const newBal = parseFloat(state.balanceInput);
    if (isNaN(newBal) || newBal <= 0) return;
    try {
      const res = await fetch("/api/balance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: newBal }),
      });
      if (res.ok) {
        dispatch({ type: "BALANCE_UPDATED" });
        fetchDashboard(true);
      }
    } catch {
      showError("Failed to update balance");
    }
  }

  async function markActionDone(stopHistoryId: string) {
    try {
      const res = await fetch(`/api/stops/${stopHistoryId}`, { method: "PATCH" });
      if (res.ok) fetchDashboard(true);
    } catch {
      showError("Failed to update stop");
    }
  }

  function requestStopPush(tradeId: string) {
    // Find the trade and instruction to build the confirmation payload
    const trade = state.data?.openTrades.find((t) => t.id === tradeId);
    if (!trade) return;
    const instr = state.data?.instructions?.find((i) => i.ticker === trade.ticker);
    const currentStop = Math.max(trade.hardStop, trade.trailingStop);
    const newStop = instr?.newStop ?? currentStop;
    const t212Stop = instr?.t212Stop ?? null;
    const currency = instr?.currency ?? "$";
    dispatch({
      type: "T212_STOP_CONFIRM",
      payload: { tradeId, ticker: trade.ticker, currentStop, newStop, t212Stop, currency },
    });
  }

  function cancelStopPush() {
    dispatch({ type: "T212_STOP_CANCEL" });
  }

  async function confirmPushStop() {
    const pending = state.pendingStopPush;
    if (!pending) return;
    dispatch({ type: "T212_STOP_START", tradeId: pending.tradeId });
    try {
      const res = await fetch(`/api/t212/stops/${pending.tradeId}`, { method: "POST" });
      if (res.ok) {
        dispatch({ type: "T212_STOP_DONE", tradeId: pending.tradeId });
        fetchDashboard(true);
      } else {
        const json = await res.json().catch(() => ({ error: "Failed" }));
        showError(json.error ?? "Failed to push stop to T212");
        dispatch({ type: "T212_STOP_FAIL" });
      }
    } catch {
      showError("Failed to push stop to T212");
      dispatch({ type: "T212_STOP_FAIL" });
    }
  }

  async function pushStopByTicker(ticker: string, stopPrice: number) {
    dispatch({ type: "T212_TICKER_STOP_START", ticker });
    try {
      const res = await fetch("/api/t212/stops/ticker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, stopPrice }),
      });
      if (res.ok) {
        dispatch({ type: "T212_TICKER_STOP_DONE" });
        fetchDashboard(true);
      } else {
        const json = await res.json().catch(() => ({ error: "Failed" }));
        showError(json.error ?? "Failed to push stop to T212");
        dispatch({ type: "T212_TICKER_STOP_FAIL" });
      }
    } catch {
      showError("Failed to push stop to T212");
      dispatch({ type: "T212_TICKER_STOP_FAIL" });
    }
  }

  async function importT212Position(position: { ticker: string; quantity: number; averagePrice: number; currentPrice: number }) {
    dispatch({ type: "IMPORT_ONE_START", ticker: position.ticker });
    try {
      const res = await fetch("/api/t212/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: position.ticker,
          quantity: position.quantity,
          avgPrice: position.averagePrice,
          currentPrice: position.currentPrice,
        }),
      });
      if (res.ok) {
        dispatch({ type: "IMPORT_ONE_DONE" });
        await syncAllPositions();
      } else {
        const json = await res.json().catch(() => ({ error: "Failed" }));
        showError(json.error ?? "Failed to import position");
        dispatch({ type: "IMPORT_ONE_FAIL" });
      }
    } catch {
      showError("Failed to import position");
      dispatch({ type: "IMPORT_ONE_FAIL" });
    }
  }

  async function importAllT212Positions() {
    dispatch({ type: "IMPORT_ALL_START" });
    try {
      const res = await fetch("/api/t212/import-all", { method: "POST" });
      if (res.ok) {
        const json = await res.json();
        dispatch({ type: "IMPORT_ALL_DONE" });
        if (json.failed > 0) {
          showError(`Imported ${json.imported}, failed ${json.failed}`);
        }
        await syncAllPositions();
      } else {
        const json = await res.json().catch(() => ({ error: "Failed" }));
        showError(json.error ?? "Failed to import positions");
        dispatch({ type: "IMPORT_ALL_FAIL" });
      }
    } catch {
      showError("Failed to import positions");
      dispatch({ type: "IMPORT_ALL_FAIL" });
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const openTrades = state.data?.openTrades ?? [];
  const recentSignals = state.data?.recentSignals ?? [];
  const closedTrades = state.data?.closedTrades ?? [];
  const balance = state.data?.account?.balance ?? 0;
  const openCount = openTrades.length;
  const totalExposure = openTrades.reduce((s, t) => s + t.entryPrice * t.shares, 0);
  const exposurePct = balance > 0 ? ((totalExposure / balance) * 100).toFixed(1) : "0.0";

  const wins = closedTrades.filter((t) => (t.rMultiple ?? 0) > 0).length;
  const winRate =
    closedTrades.length > 0
      ? ((wins / closedTrades.length) * 100).toFixed(0)
      : "—";
  const avgR =
    closedTrades.length > 0
      ? (closedTrades.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / closedTrades.length).toFixed(2)
      : "—";

  const instructions = state.data?.instructions ?? [];
  const serverActions = state.data?.actions ?? [];

  const actionItems = [...serverActions];
  if (state.scanResult && !state.scanResult.dryRun) {
    for (const s of state.scanResult.signalsFired) {
      const alreadyPlaced = openTrades.some((t) => t.ticker === s.ticker);
      if (!alreadyPlaced) {
        actionItems.push({
          type: "NEW_SIGNAL",
          ticker: s.ticker,
          message: `New signal — ${s.ticker} — see scan panel`,
          urgency: "MEDIUM",
        });
      }
    }
  }

  return {
    // State
    ...state,

    // Derived
    openTrades,
    recentSignals,
    closedTrades,
    balance,
    openCount,
    exposurePct,
    winRate,
    avgR,
    instructions,
    actionItems,

    // Async actions
    syncPosition,
    syncAllPositions,
    runScan,
    markPlaced,
    markExited,
    updateBalance,
    markActionDone,
    pushStopToT212: requestStopPush,
    confirmPushStop,
    cancelStopPush,
    pushStopByTicker,
    importT212Position,
    importAllT212Positions,

    // UI actions
    dismissError: () => dispatch({ type: "CLEAR_ERROR" }),
    openConfirm: () => dispatch({ type: "SHOW_CONFIRM" }),
    closeConfirm: () => dispatch({ type: "HIDE_CONFIRM" }),
    startBalanceEdit: (current: number) =>
      dispatch({ type: "START_BALANCE_EDIT", current: String(current) }),
    cancelBalanceEdit: () => dispatch({ type: "CANCEL_BALANCE_EDIT" }),
    setBalanceInput: (value: string) =>
      dispatch({ type: "SET_BALANCE_INPUT", value }),
    startExit: (tradeId: string) =>
      dispatch({ type: "START_EXIT", tradeId }),
    cancelExit: () => dispatch({ type: "CANCEL_EXIT" }),
    setExitPrice: (price: string) =>
      dispatch({ type: "SET_EXIT_PRICE", price }),
    toggleExpand: (tradeId: string) =>
      dispatch({ type: "TOGGLE_EXPAND", tradeId }),
  };
}
