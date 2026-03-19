function envFloat(key: string, fallback: number): number {
  const val = process.env[key];
  if (val == null) return fallback;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? fallback : parsed;
}

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val == null) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export interface VolumeTurtleConfig {
  balance: number;
  maxPositions: number;
  riskPctPerTrade: number;
  volumeSpikeMultiplier: number;
  rangePositionThreshold: number;
  atrPeriod: number;
  trailingStopDays: number;
  hardStopAtrMultiple: number;
  scoreWeightRegime: number;
  scoreWeightTrend: number;
  scoreWeightVolume: number;
  scoreWeightLiquidity: number;
  cautionDrawdownPct: number;
  pauseDrawdownPct: number;
  quoteBatchSize: number;
  quoteBatchDelayMs: number;
  quoteLookbackDays: number;
  dashboardPageSize: number;
  dashboardLookbackDays: number;
  lseScanHour: number;
  lseScanMinute: number;
  usScanHour: number;
  usScanMinute: number;
  syncDelayMs: number;
}

export const config: VolumeTurtleConfig = {
  balance: envFloat("VOLUME_TURTLE_BALANCE", 1000),
  maxPositions: envInt("MAX_POSITIONS", 5),
  riskPctPerTrade: envFloat("RISK_PER_TRADE_PCT", 2) / 100,
  volumeSpikeMultiplier: envFloat("VOLUME_SPIKE_MULTIPLIER", 2),
  rangePositionThreshold: envFloat("RANGE_POSITION_THRESHOLD", 0.75),
  atrPeriod: envInt("ATR_PERIOD", 20),
  trailingStopDays: envInt("TRAILING_STOP_DAYS", 10),
  hardStopAtrMultiple: envFloat("HARD_STOP_ATR_MULTIPLE", 2),
  scoreWeightRegime: envFloat("SCORE_WEIGHT_REGIME", 0.40),
  scoreWeightTrend: envFloat("SCORE_WEIGHT_TREND", 0.30),
  scoreWeightVolume: envFloat("SCORE_WEIGHT_VOLUME", 0.20),
  scoreWeightLiquidity: envFloat("SCORE_WEIGHT_LIQUIDITY", 0.10),
  cautionDrawdownPct: envFloat("CAUTION_DRAWDOWN_PCT", 10),
  pauseDrawdownPct: envFloat("PAUSE_DRAWDOWN_PCT", 20),
  quoteBatchSize: envInt("QUOTE_BATCH_SIZE", 10),
  quoteBatchDelayMs: envInt("QUOTE_BATCH_DELAY_MS", 500),
  quoteLookbackDays: envInt("QUOTE_LOOKBACK_DAYS", 60),
  dashboardPageSize: envInt("DASHBOARD_PAGE_SIZE", 20),
  dashboardLookbackDays: envInt("DASHBOARD_LOOKBACK_DAYS", 14),
  lseScanHour: envInt("LSE_SCAN_HOUR", 17),
  lseScanMinute: envInt("LSE_SCAN_MINUTE", 30),
  usScanHour: envInt("US_SCAN_HOUR", 22),
  usScanMinute: envInt("US_SCAN_MINUTE", 0),
  syncDelayMs: envInt("SYNC_DELAY_MS", 500),
};

// Validate config at load time
if (config.balance <= 0) throw new Error("VOLUME_TURTLE_BALANCE must be positive");
if (config.maxPositions < 1) throw new Error("MAX_POSITIONS must be >= 1");
if (config.riskPctPerTrade <= 0 || config.riskPctPerTrade > 0.1) {
  throw new Error("RISK_PER_TRADE_PCT must be between 0 and 10 (parsed as 0–0.1)");
}
if (config.atrPeriod < 5) throw new Error("ATR_PERIOD must be >= 5");
if (config.trailingStopDays < 1) throw new Error("TRAILING_STOP_DAYS must be >= 1");

import { createLogger } from "@/lib/logger";

const log = createLogger("config");

const weightSum = config.scoreWeightRegime + config.scoreWeightTrend + config.scoreWeightVolume + config.scoreWeightLiquidity;
if (Math.abs(weightSum - 1.0) > 0.01) {
  log.warn({ weightSum: weightSum.toFixed(3) }, "Score weights do not sum to ~1.0");
}
