"use client";

import { useReducer, useCallback } from "react";
import type { ScanResponse } from "../components/types";

// ── State ─────────────────────────────────────────────────────────────────────

interface ScanState {
  scanRunning: boolean;
  scanResult: ScanResponse | null;
  scanError: string | null;
  showConfirm: boolean;
}

const initialState: ScanState = {
  scanRunning: false,
  scanResult: null,
  scanError: null,
  showConfirm: false,
};

// ── Actions ───────────────────────────────────────────────────────────────────

type ScanAction =
  | { type: "SCAN_START" }
  | { type: "SCAN_SUCCESS"; result: ScanResponse }
  | { type: "SCAN_ERROR"; error: string }
  | { type: "SHOW_CONFIRM" }
  | { type: "HIDE_CONFIRM" };

function reducer(state: ScanState, action: ScanAction): ScanState {
  switch (action.type) {
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
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useScanRunner(refresh: () => void) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const runScan = useCallback(
    async (dry: boolean) => {
      dispatch({ type: "SCAN_START" });
      try {
        const res = await fetch(`/api/scan?dry=${dry}`);
        const json = await res.json();
        if (json.error) {
          dispatch({ type: "SCAN_ERROR", error: json.error });
        } else {
          dispatch({ type: "SCAN_SUCCESS", result: json });
          refresh();
        }
      } catch (err) {
        dispatch({
          type: "SCAN_ERROR",
          error: err instanceof Error ? err.message : "Scan failed",
        });
      }
    },
    [refresh],
  );

  const openConfirm = useCallback(
    () => dispatch({ type: "SHOW_CONFIRM" }),
    [],
  );

  const closeConfirm = useCallback(
    () => dispatch({ type: "HIDE_CONFIRM" }),
    [],
  );

  return {
    scanRunning: state.scanRunning,
    scanResult: state.scanResult,
    scanError: state.scanError,
    showConfirm: state.showConfirm,
    runScan,
    openConfirm,
    closeConfirm,
  };
}
