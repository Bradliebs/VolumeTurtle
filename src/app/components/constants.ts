/** Centralised UI constants — single source of truth for polling, timeouts, tolerances. */

export const POLLING_INTERVALS = {
  /** Dashboard auto-refresh interval (ms) */
  DASHBOARD_REFRESH: 60_000,
  /** Position sync TTL — won't re-sync within this window (ms) */
  POSITION_SYNC_TTL: 300_000,
  /** Error toast auto-dismiss (ms) */
  ERROR_TOAST_DURATION: 6_000,
  /** Success toast auto-dismiss (ms) */
  SUCCESS_TOAST_DURATION: 4_000,
  /** Exit flash animation duration (ms) */
  EXIT_FLASH_DURATION: 1_500,
} as const;

export const TOLERANCES = {
  /** Stop price comparison tolerance (absolute) */
  STOP_EPSILON: 0.01,
  /** Price drift % below which no action is needed */
  PRICE_DRIFT_MIN: 0.002,
} as const;
