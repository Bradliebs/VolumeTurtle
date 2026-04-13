"use client";

import { useReducer, useCallback } from "react";
import type { SignalFired } from "../components/types";

// ── State ─────────────────────────────────────────────────────────────────────

interface TradeActionsState {
  placingTicker: string | null;
  exitingTradeId: string | null;
  exitPrice: string;
  editingBalance: boolean;
  balanceInput: string;
  expandedTradeId: string | null;
}

const initialState: TradeActionsState = {
  placingTicker: null,
  exitingTradeId: null,
  exitPrice: "",
  editingBalance: false,
  balanceInput: "",
  expandedTradeId: null,
};

// ── Actions ───────────────────────────────────────────────────────────────────

type Action =
  | { type: "SET_PLACING"; ticker: string | null }
  | { type: "START_EXIT"; tradeId: string }
  | { type: "CANCEL_EXIT" }
  | { type: "SET_EXIT_PRICE"; price: string }
  | { type: "START_BALANCE_EDIT"; current: string }
  | { type: "CANCEL_BALANCE_EDIT" }
  | { type: "SET_BALANCE_INPUT"; value: string }
  | { type: "BALANCE_UPDATED" }
  | { type: "TOGGLE_EXPAND"; tradeId: string };

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: TradeActionsState, action: Action): TradeActionsState {
  switch (action.type) {
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
    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useTradeActions(
  refresh: () => void,
  showError: (msg: string) => void,
  showSuccess: (msg: string) => void,
) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const markPlaced = useCallback(
    async (signal: SignalFired) => {
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
        if (res.ok) refresh();
      } catch {
        showError("Failed to place trade");
      } finally {
        dispatch({ type: "SET_PLACING", ticker: null });
      }
    },
    [refresh, showError],
  );

  const markExited = useCallback(
    async (tradeId: string) => {
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
          refresh();
        }
      } catch {
        showError("Failed to record exit");
      }
    },
    [state.exitPrice, refresh, showError],
  );

  const updateBalance = useCallback(async () => {
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
        refresh();
      }
    } catch {
      showError("Failed to update balance");
    }
  }, [state.balanceInput, refresh, showError]);

  const startExit = useCallback(
    (tradeId: string) => dispatch({ type: "START_EXIT", tradeId }),
    [],
  );

  const cancelExit = useCallback(
    () => dispatch({ type: "CANCEL_EXIT" }),
    [],
  );

  const setExitPrice = useCallback(
    (price: string) => dispatch({ type: "SET_EXIT_PRICE", price }),
    [],
  );

  const startBalanceEdit = useCallback(
    (current: number) =>
      dispatch({ type: "START_BALANCE_EDIT", current: String(current) }),
    [],
  );

  const cancelBalanceEdit = useCallback(
    () => dispatch({ type: "CANCEL_BALANCE_EDIT" }),
    [],
  );

  const setBalanceInput = useCallback(
    (value: string) => dispatch({ type: "SET_BALANCE_INPUT", value }),
    [],
  );

  const toggleExpand = useCallback(
    (tradeId: string) => dispatch({ type: "TOGGLE_EXPAND", tradeId }),
    [],
  );

  return {
    ...state,
    markPlaced,
    markExited,
    updateBalance,
    startExit,
    cancelExit,
    setExitPrice,
    startBalanceEdit,
    cancelBalanceEdit,
    setBalanceInput,
    toggleExpand,
  };
}
