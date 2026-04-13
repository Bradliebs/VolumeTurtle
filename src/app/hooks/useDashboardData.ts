"use client";

import { useReducer, useEffect, useCallback } from "react";
import type { DashboardData } from "../components/types";

// ── State ─────────────────────────────────────────────────────────────────────

interface DataState {
  data: DashboardData | null;
  loading: boolean;
  refreshing: boolean;
}

const initialState: DataState = {
  data: null,
  loading: true,
  refreshing: false,
};

// ── Actions ───────────────────────────────────────────────────────────────────

type Action =
  | { type: "FETCH_START"; refresh: boolean }
  | { type: "FETCH_SUCCESS"; data: DashboardData }
  | { type: "FETCH_DONE" };

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: DataState, action: Action): DataState {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, refreshing: action.refresh };
    case "FETCH_SUCCESS":
      return { ...state, data: action.data, loading: false, refreshing: false };
    case "FETCH_DONE":
      return { ...state, loading: false, refreshing: false };
    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDashboardData() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    dispatch({ type: "FETCH_START", refresh: isRefresh });
    try {
      const res = await fetch("/api/dashboard");
      if (res.ok) {
        dispatch({ type: "FETCH_SUCCESS", data: await res.json() });
      } else {
        dispatch({ type: "FETCH_DONE" });
      }
    } catch {
      dispatch({ type: "FETCH_DONE" });
    }
  }, []);

  // Initial fetch + 60-second auto-refresh
  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(() => fetchDashboard(true), 60_000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const refresh = useCallback(() => fetchDashboard(true), [fetchDashboard]);

  return {
    data: state.data,
    loading: state.loading,
    refreshing: state.refreshing,
    refresh,
  };
}
