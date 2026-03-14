import type { RegimeAssessment } from "./regimeFilter";
import { config } from "@/lib/config";

export interface CompositeScore {
  total: number;
  components: {
    regimeScore: number;
    trendScore: number;
    volumeScore: number;
    liquidityScore: number;
  };
  grade: "A" | "B" | "C" | "D";
  gradeReason: string;
}

/**
 * Calculate a composite signal ranking score (0.0–1.0).
 * Weights four factors: regime, trend, volume, liquidity.
 */
export function calculateCompositeScore(
  regimeAssessment: RegimeAssessment | null,
  volumeRatio: number,
  avgDollarVolume20: number,
): CompositeScore {
  const W = {
    regime: config.scoreWeightRegime,
    trend: config.scoreWeightTrend,
    volume: config.scoreWeightVolume,
    liquidity: config.scoreWeightLiquidity,
  };

  // 1. Regime Score (0–3 points → normalised 0.0–1.0)
  const regimeRaw = regimeAssessment ? regimeAssessment.score / 3 : 0.5;
  const regimeScore = regimeRaw * W.regime;

  // 2. Trend Score — how far above/below 50-day MA
  let trendRaw = 0.5;
  if (regimeAssessment) {
    const pct = regimeAssessment.tickerRegime.pctAboveMA50;
    if (pct === null) {
      trendRaw = 0.5;
    } else if (pct >= 20) {
      trendRaw = 1.0;
    } else if (pct >= 10) {
      trendRaw = 0.8;
    } else if (pct >= 0) {
      trendRaw = 0.6;
    } else if (pct >= -5) {
      trendRaw = 0.3;
    } else if (pct >= -15) {
      trendRaw = 0.1;
    } else {
      trendRaw = 0.0;
    }
  }
  const trendScore = trendRaw * W.trend;

  // 3. Volume Score — 2x minimum, 5x cap
  const ratio = Math.min(volumeRatio, 5.0);
  const volumeRaw = Math.max(0, (ratio - 2.0) / 3.0);
  const volumeScore = volumeRaw * W.volume;

  // 4. Liquidity Score — average daily dollar volume
  let liquidityRaw = 0.2;
  if (avgDollarVolume20 >= 5_000_000) {
    liquidityRaw = 1.0;
  } else if (avgDollarVolume20 >= 2_000_000) {
    liquidityRaw = 0.7;
  } else if (avgDollarVolume20 >= 1_000_000) {
    liquidityRaw = 0.4;
  }
  const liquidityScore = liquidityRaw * W.liquidity;

  // Total
  const total = regimeScore + trendScore + volumeScore + liquidityScore;

  // Grade
  let grade: CompositeScore["grade"];
  let gradeReason: string;

  if (total >= 0.75) {
    grade = "A";
    gradeReason = "Strong conditions across all factors";
  } else if (total >= 0.55) {
    grade = "B";
    gradeReason = "Good signal, minor weaknesses";
  } else if (total >= 0.35) {
    grade = "C";
    gradeReason = "Marginal — consider passing";
  } else {
    grade = "D";
    gradeReason = "Weak conditions — high false signal risk";
  }

  return {
    total,
    components: { regimeScore, trendScore, volumeScore, liquidityScore },
    grade,
    gradeReason,
  };
}
