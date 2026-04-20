"use client";

import { useReducer, useCallback } from "react";
import type {
  DashboardData,
  SignalFired,
  SyncResult,
} from "../components/types";

// ── State ─────────────────────────────────────────────────────────────────────

interface T212ActionsState {
  pushingStopTradeId: string | null;
  pushingStopTicker: string | null;
  pendingStopPush: {
    tradeId: string;
    ticker: string;
    currentStop: number;
    newStop: number;
    t212Stop: number | null;
    currency: string;
  } | null;
  importingTicker: string | null;
  importingAll: boolean;
  importProgress: string;
  buyingSignal: SignalFired | null;
  buyingTicker: string | null;
}

const initialState: T212ActionsState = {
  pushingStopTradeId: null,
  pushingStopTicker: null,
  pendingStopPush: null,
  importingTicker: null,
  importingAll: false,
  importProgress: "",
  buyingSignal: null,
  buyingTicker: null,
};

// ── Actions ───────────────────────────────────────────────────────────────────

type Action =
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
  | { type: "BUY_CONFIRM"; signal: SignalFired }
  | { type: "BUY_CANCEL" }
  | { type: "BUY_START"; ticker: string }
  | { type: "BUY_DONE" }
  | { type: "BUY_FAIL" };

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: T212ActionsState, action: Action): T212ActionsState {
  switch (action.type) {
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

    case "BUY_CONFIRM":
      return { ...state, buyingSignal: action.signal };
    case "BUY_CANCEL":
      return { ...state, buyingSignal: null };
    case "BUY_START":
      return { ...state, buyingTicker: action.ticker };
    case "BUY_DONE":
      return { ...state, buyingSignal: null, buyingTicker: null };
    case "BUY_FAIL":
      return { ...state, buyingTicker: null };

    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useT212Actions(
  refresh: () => void,
  syncAllPositions: () => Promise<void>,
  showError: (msg: string) => void,
  showSuccess: (msg: string) => void,
  data: DashboardData | null,
  _syncData: Record<string, SyncResult>,
) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const pushStopToT212 = useCallback(
    (tradeId: string) => {
      // Find the trade and instruction to build the confirmation payload
      const trade = data?.openTrades.find((t) => t.id === tradeId);
      if (!trade) return;
      const instr = data?.instructions?.find((i) => i.ticker === trade.ticker);
      const currentStop = Math.max(trade.hardStop, trade.trailingStop);
      const rawNewStop = instr?.newStop ?? currentStop;
      const t212Stop = instr?.t212Stop ?? null;
      const currency = instr?.currency ?? "$";

      // Monotonic guard: never propose a stop lower than T212's current stop
      const newStop = t212Stop != null ? Math.max(rawNewStop, t212Stop) : rawNewStop;

      if (t212Stop != null && newStop <= t212Stop + 0.01) {
        showError(`T212 stop already at ${currency}${t212Stop.toFixed(2)} — no update needed`);
        return;
      }

      dispatch({
        type: "T212_STOP_CONFIRM",
        payload: { tradeId, ticker: trade.ticker, currentStop, newStop, t212Stop, currency },
      });
    },
    [data, showError],
  );

  const confirmPushStop = useCallback(async () => {
    const pending = state.pendingStopPush;
    if (!pending) return;
    dispatch({ type: "T212_STOP_START", tradeId: pending.tradeId });
    try {
      const res = await fetch(`/api/t212/stops/${pending.tradeId}`, { method: "POST" });
      if (res.ok) {
        dispatch({ type: "T212_STOP_DONE", tradeId: pending.tradeId });
        refresh();
      } else {
        const json = await res.json().catch(() => ({ error: "Failed" }));
        showError(json.error ?? "Failed to push stop to T212");
        dispatch({ type: "T212_STOP_FAIL" });
      }
    } catch {
      showError("Failed to push stop to T212");
      dispatch({ type: "T212_STOP_FAIL" });
    }
  }, [state.pendingStopPush, refresh, showError]);

  const cancelStopPush = useCallback(
    () => dispatch({ type: "T212_STOP_CANCEL" }),
    [],
  );

  const pushStopByTicker = useCallback(
    async (ticker: string, stopPrice: number) => {
      dispatch({ type: "T212_TICKER_STOP_START", ticker });
      try {
        const res = await fetch("/api/t212/stops/ticker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker, stopPrice }),
        });
        if (res.ok) {
          dispatch({ type: "T212_TICKER_STOP_DONE" });
          refresh();
        } else {
          const json = await res.json().catch(() => ({ error: "Failed" }));
          showError(json.error ?? "Failed to push stop to T212");
          dispatch({ type: "T212_TICKER_STOP_FAIL" });
        }
      } catch {
        showError("Failed to push stop to T212");
        dispatch({ type: "T212_TICKER_STOP_FAIL" });
      }
    },
    [refresh, showError],
  );

  const importT212Position = useCallback(
    async (position: { ticker: string; quantity: number; averagePrice: number; currentPrice: number }) => {
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
          const json = await res.json().catch(() => ({}));
          dispatch({ type: "IMPORT_ONE_DONE" });
          const grade = json.matchedSignal?.grade ? ` (grade ${json.matchedSignal.grade})` : "";
          showSuccess(`✓ ${position.ticker} imported${grade}`);
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
    },
    [syncAllPositions, showError, showSuccess],
  );

  const importAllT212Positions = useCallback(async () => {
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
  }, [syncAllPositions, showError]);

  const requestBuy = useCallback(
    (signal: SignalFired) => dispatch({ type: "BUY_CONFIRM", signal }),
    [],
  );

  const cancelBuy = useCallback(
    () => dispatch({ type: "BUY_CANCEL" }),
    [],
  );

  const confirmBuy = useCallback(async () => {
    const signal = state.buyingSignal;
    if (!signal || !signal.positionSize) return;

    dispatch({ type: "BUY_START", ticker: signal.ticker });
    try {
      const res = await fetch("/api/t212/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: signal.ticker,
          shares: signal.positionSize.shares,
          suggestedEntry: signal.suggestedEntry,
          hardStop: signal.hardStop,
          riskPerShare: signal.riskPerShare,
          volumeRatio: signal.volumeRatio,
          rangePosition: signal.rangePosition,
          atr20: signal.atr20,
          signalSource: "volume",
          signalScore: signal.compositeScore?.total ?? undefined,
          signalGrade: signal.compositeScore?.grade ?? undefined,
        }),
      });
      if (res.ok) {
        dispatch({ type: "BUY_DONE" });
        const grade = signal.compositeScore?.grade ? ` (grade ${signal.compositeScore.grade})` : "";
        showSuccess(`✓ ${signal.ticker} bought on T212${grade} — stop set at ${signal.hardStop.toFixed(2)}`);
        refresh();
      } else {
        const json = await res.json().catch(() => ({ error: "Failed" }));
        showError(json.error ?? "Failed to buy on T212");
        dispatch({ type: "BUY_FAIL" });
      }
    } catch {
      showError("Failed to buy on T212");
      dispatch({ type: "BUY_FAIL" });
    }
  }, [state.buyingSignal, refresh, showError, showSuccess]);

  const markActionDone = useCallback(
    async (stopHistoryId: string) => {
      try {
        const res = await fetch(`/api/stops/${stopHistoryId}`, { method: "PATCH" });
        if (res.ok) refresh();
      } catch {
        showError("Failed to update stop");
      }
    },
    [refresh, showError],
  );

  return {
    ...state,
    pushStopToT212,
    confirmPushStop,
    cancelStopPush,
    pushStopByTicker,
    importT212Position,
    importAllT212Positions,
    requestBuy,
    confirmBuy,
    cancelBuy,
    markActionDone,
  };
}
