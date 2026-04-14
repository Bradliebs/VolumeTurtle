"use client";

import { useReducer, useEffect, useCallback, useRef } from "react";
import type { DashboardData } from "../components/types";
import { POLLING_INTERVALS } from "../components/constants";

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
  const abortRef = useRef<AbortController | null>(null);

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    dispatch({ type: "FETCH_START", refresh: isRefresh });
    try {
      const res = await fetch("/api/dashboard", { signal: abortRef.current.signal });
      if (res.ok) {
        dispatch({ type: "FETCH_SUCCESS", data: await res.json() });
      } else {
        dispatch({ type: "FETCH_DONE" });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      dispatch({ type: "FETCH_DONE" });
    }
  }, []);

  // Initial fetch + auto-refresh (pauses when tab is hidden)
  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(() => {
      if (!document.hidden) fetchDashboard(true);
    }, POLLING_INTERVALS.DASHBOARD_REFRESH);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [fetchDashboard]);

  const refresh = useCallback(() => fetchDashboard(true), [fetchDashboard]);

  return {
    data: state.data,
    loading: state.loading,
    refreshing: state.refreshing,
    refresh,
  };
}
