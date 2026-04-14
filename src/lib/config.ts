// TradeCore — unified trading system
// Signal engines: VolumeTurtle (volume spike) +
//                 HBME (sector momentum breakout)

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

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val == null) return fallback;
  const normalized = val.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export interface VolumeTurtleConfig {
  balance: number;
  maxPositions: number;
  riskPctPerTrade: number;
  volumeSpikeMultiplier: number;
  MOMENTUM_ENABLED: boolean;
  VOLUME_SPIKE_MIN: number;
  BREAKOUT_MIN_CHG: number;
  BREAKOUT_MIN_VOL: number;
  SCORE_WEIGHT_REGIME: number;
  SCORE_WEIGHT_BREAKOUT: number;
  SCORE_WEIGHT_SECTOR: number;
  SCORE_WEIGHT_LIQUIDITY: number;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  rangePositionThreshold: number;
  atrPeriod: number;
  trailingStopDays: number;
  hardStopAtrMultiple: number;
  trailAtrMultiple: number;
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
  vixNormalSizeMult: number;
  vixElevatedSizeMult: number;
  vixPanicSizeMult: number;
}

const volumeSpikeMin = envFloat("VOLUME_SPIKE_MIN", envFloat("VOLUME_SPIKE_MULTIPLIER", 2.0));

export const config: VolumeTurtleConfig = {
  balance: envFloat("VOLUME_TURTLE_BALANCE", 1000),
  maxPositions: envInt("MAX_POSITIONS", 5),
  riskPctPerTrade: envFloat("RISK_PER_TRADE_PCT", 2) / 100,
  volumeSpikeMultiplier: volumeSpikeMin,
  MOMENTUM_ENABLED: envBool("MOMENTUM_ENABLED", true),
  VOLUME_SPIKE_MIN: volumeSpikeMin,
  BREAKOUT_MIN_CHG: envFloat("BREAKOUT_MIN_CHG", 0.10),
  BREAKOUT_MIN_VOL: envFloat("BREAKOUT_MIN_VOL", 3.0),
  SCORE_WEIGHT_REGIME: envFloat("SCORE_WEIGHT_REGIME", 0.35),
  SCORE_WEIGHT_BREAKOUT: envFloat("SCORE_WEIGHT_BREAKOUT", 0.30),
  SCORE_WEIGHT_SECTOR: envFloat("SCORE_WEIGHT_SECTOR", 0.25),
  SCORE_WEIGHT_LIQUIDITY: envFloat("SCORE_WEIGHT_LIQUIDITY", 0.10),
  // Note: SCORE_WEIGHT_REGIME (uppercase) retained for breakoutEngine.ts (sacred).
  // scoreWeightRegime (lowercase) is used by compositeScore.ts (sacred).
  // Both now default to 0.35 — no mismatch.
  TELEGRAM_BOT_TOKEN: process.env["TELEGRAM_BOT_TOKEN"] ?? "",
  TELEGRAM_CHAT_ID: process.env["TELEGRAM_CHAT_ID"] ?? "",
  rangePositionThreshold: envFloat("RANGE_POSITION_THRESHOLD", 0.75),
  atrPeriod: envInt("ATR_PERIOD", 20),
  trailingStopDays: envInt("TRAILING_STOP_DAYS", 10),
  hardStopAtrMultiple: envFloat("HARD_STOP_ATR_MULTIPLE", 1.5),
  trailAtrMultiple: envFloat("TRAIL_ATR_MULTIPLE", 2),
  scoreWeightRegime: envFloat("SCORE_WEIGHT_REGIME", 0.35),
  scoreWeightTrend: envFloat("SCORE_WEIGHT_TREND", 0.30),
  scoreWeightVolume: envFloat("SCORE_WEIGHT_VOLUME", 0.25),
  scoreWeightLiquidity: envFloat("SCORE_WEIGHT_LIQUIDITY", 0.10),
  cautionDrawdownPct: envFloat("CAUTION_DRAWDOWN_PCT", 10),
  pauseDrawdownPct: envFloat("PAUSE_DRAWDOWN_PCT", 20),
  quoteBatchSize: envInt("QUOTE_BATCH_SIZE", 10),
  quoteBatchDelayMs: envInt("QUOTE_BATCH_DELAY_MS", 500),
  quoteLookbackDays: envInt("QUOTE_LOOKBACK_DAYS", 120),
  dashboardPageSize: envInt("DASHBOARD_PAGE_SIZE", 20),
  dashboardLookbackDays: envInt("DASHBOARD_LOOKBACK_DAYS", 14),
  lseScanHour: envInt("LSE_SCAN_HOUR", 17),
  lseScanMinute: envInt("LSE_SCAN_MINUTE", 30),
  usScanHour: envInt("US_SCAN_HOUR", 22),
  usScanMinute: envInt("US_SCAN_MINUTE", 0),
  syncDelayMs: envInt("SYNC_DELAY_MS", 500),
  vixNormalSizeMult: envFloat("VIX_NORMAL_SIZE_MULT", 1.0),
  vixElevatedSizeMult: envFloat("VIX_ELEVATED_SIZE_MULT", 0.75),
  vixPanicSizeMult: envFloat("VIX_PANIC_SIZE_MULT", 0.0),
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

/**
 * Load AppSettings from the database and patch the in-memory config.
 * Falls back gracefully to env-var defaults if DB is unavailable.
 * Safe to call multiple times — last write wins.
 */
export async function applyDbSettings(): Promise<void> {
  try {
    const { prisma } = await import("@/db/client");
    const db = prisma as unknown as {
      appSettings: {
        findFirst: (args: { orderBy: { id: "asc" } }) => Promise<{
          momentumEnabled: boolean;
          breakoutMinChg: number;
          breakoutMinVol: number;
          scoreWeightRegime: number;
          scoreWeightBreakout: number;
          scoreWeightSector: number;
          scoreWeightLiquidity: number;
        } | null>;
      };
    };
    const row = await db.appSettings.findFirst({ orderBy: { id: "asc" } });
    if (row) {
      config.MOMENTUM_ENABLED = row.momentumEnabled;
      config.BREAKOUT_MIN_CHG = row.breakoutMinChg;
      config.BREAKOUT_MIN_VOL = row.breakoutMinVol;
      config.SCORE_WEIGHT_REGIME = row.scoreWeightRegime;
      config.scoreWeightRegime = row.scoreWeightRegime;
      config.SCORE_WEIGHT_BREAKOUT = row.scoreWeightBreakout;
      config.SCORE_WEIGHT_SECTOR = row.scoreWeightSector;
      config.SCORE_WEIGHT_LIQUIDITY = row.scoreWeightLiquidity;
      log.info("Loaded AppSettings from database");
    }
  } catch {
    // DB unavailable — env-var defaults already applied
  }
}
