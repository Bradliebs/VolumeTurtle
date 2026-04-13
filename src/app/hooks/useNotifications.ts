"use client";

import { useReducer, useCallback, useRef } from "react";

// ── State ─────────────────────────────────────────────────────────────────────

interface NotificationState {
  errorMsg: string | null;
  successMsg: string | null;
  exitFlash: boolean;
}

const initialState: NotificationState = {
  errorMsg: null,
  successMsg: null,
  exitFlash: false,
};

// ── Actions ───────────────────────────────────────────────────────────────────

type Action =
  | { type: "SET_ERROR"; msg: string }
  | { type: "CLEAR_ERROR" }
  | { type: "SET_SUCCESS"; msg: string }
  | { type: "CLEAR_SUCCESS" }
  | { type: "EXIT_FLASH"; active: boolean };

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state: NotificationState, action: Action): NotificationState {
  switch (action.type) {
    case "SET_ERROR":
      return { ...state, errorMsg: action.msg };
    case "CLEAR_ERROR":
      return { ...state, errorMsg: null };
    case "SET_SUCCESS":
      return { ...state, successMsg: action.msg };
    case "CLEAR_SUCCESS":
      return { ...state, successMsg: null };
    case "EXIT_FLASH":
      return { ...state, exitFlash: action.active };
    default:
      return state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNotifications() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((msg: string) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    dispatch({ type: "SET_ERROR", msg });
    errorTimerRef.current = setTimeout(() => dispatch({ type: "CLEAR_ERROR" }), 6000);
  }, []);

  const showSuccess = useCallback((msg: string) => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    dispatch({ type: "SET_SUCCESS", msg });
    successTimerRef.current = setTimeout(() => dispatch({ type: "CLEAR_SUCCESS" }), 4000);
  }, []);

  const dismissError = useCallback(() => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    dispatch({ type: "CLEAR_ERROR" });
  }, []);

  const dismissSuccess = useCallback(() => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    dispatch({ type: "CLEAR_SUCCESS" });
  }, []);

  const triggerExitFlash = useCallback(() => {
    if (exitFlashTimerRef.current) clearTimeout(exitFlashTimerRef.current);
    dispatch({ type: "EXIT_FLASH", active: true });
    exitFlashTimerRef.current = setTimeout(() => dispatch({ type: "EXIT_FLASH", active: false }), 2000);
  }, []);

  return {
    errorMsg: state.errorMsg,
    successMsg: state.successMsg,
    exitFlash: state.exitFlash,
    showError,
    showSuccess,
    dismissError,
    dismissSuccess,
    triggerExitFlash,
  };
}
