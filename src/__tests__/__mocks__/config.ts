import type { VolumeTurtleConfig } from "@/lib/config";

export const config: VolumeTurtleConfig = {
  balance: 10000,
  maxPositions: 5,
  riskPctPerTrade: 0.02,
  volumeSpikeMultiplier: 2.0,
  rangePositionThreshold: 0.75,
  atrPeriod: 20,
  trailingStopDays: 10,
  hardStopAtrMultiple: 2.0,
  trailAtrMultiple: 2.0,
  scoreWeightRegime: 0.40,
  scoreWeightTrend: 0.30,
  scoreWeightVolume: 0.20,
  scoreWeightLiquidity: 0.10,
  cautionDrawdownPct: 10,
  pauseDrawdownPct: 20,
  quoteBatchSize: 10,
  quoteBatchDelayMs: 500,
  quoteLookbackDays: 60,
};
