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
};
