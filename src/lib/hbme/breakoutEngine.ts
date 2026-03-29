import { config } from "@/lib/config";
import type {
  BreakoutCandidate,
  Candle,
  CompositeBreakoutScore,
  NearMiss,
  RegimeResult,
  SectorScore,
  UniverseRow,
} from "@/lib/hbme/types";

function pctChange(candles: Candle[], lookback: number): number {
  if (candles.length <= lookback) return 0;
  const last = candles[candles.length - 1]!.close;
  const prev = candles[candles.length - 1 - lookback]!.close;
  if (prev === 0) return 0;
  return (last - prev) / prev;
}

function volRatio(candles: Candle[], lookback = 20): number {
  if (candles.length < lookback + 1) return 0;
  const current = candles[candles.length - 1]!.volume;
  const avg = candles
    .slice(-(lookback + 1), -1)
    .reduce((sum, c) => sum + c.volume, 0) / lookback;
  if (avg <= 0) return 0;
  return current / avg;
}

function sma(candles: Candle[], period: number): number {
  if (candles.length < period) return 0;
  const values = candles.slice(-period).map((c) => c.close);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function grade(total: number): "A" | "B" | "C" | "D" {
  if (total >= 0.75) return "A";
  if (total >= 0.55) return "B";
  if (total >= 0.35) return "C";
  return "D";
}

function calculateCompositeScore(args: {
  regimeScore: number;
  chg1d: number;
  volRatio: number;
  sectorScore: number;
  sectorRank: number;
  avgDailyVolume: number;
}): CompositeBreakoutScore {
  const regimeNormalized = Math.max(0, Math.min(1, args.regimeScore / 3));
  const breakoutNormalized =
    0.5 * Math.max(0, Math.min(1, args.chg1d / Math.max(config.BREAKOUT_MIN_CHG, 0.0001))) +
    0.5 * Math.max(0, Math.min(1, args.volRatio / Math.max(config.BREAKOUT_MIN_VOL, 0.0001)));
  const sectorNormalized =
    0.6 * Math.max(0, Math.min(1, args.sectorScore)) +
    0.4 * Math.max(0, Math.min(1, (9 - Math.max(1, args.sectorRank)) / 8));

  let liquidityNormalized = 0.2;
  if (args.avgDailyVolume >= 5_000_000) liquidityNormalized = 1.0;
  else if (args.avgDailyVolume >= 2_000_000) liquidityNormalized = 0.7;
  else if (args.avgDailyVolume >= 1_000_000) liquidityNormalized = 0.4;

  const regime = regimeNormalized * config.SCORE_WEIGHT_REGIME;
  const breakout = breakoutNormalized * config.SCORE_WEIGHT_BREAKOUT;
  const sector = sectorNormalized * config.SCORE_WEIGHT_SECTOR;
  const liquidity = liquidityNormalized * config.SCORE_WEIGHT_LIQUIDITY;

  const total = regime + breakout + sector + liquidity;
  return { total, grade: grade(total), components: { regime, breakout, sector, liquidity } };
}

export function findBreakouts(
  universe: UniverseRow[],
  priceMap: Map<string, Candle[]>,
  hotSectors: string[],
  sectorScores: SectorScore[],
  minChg = config.BREAKOUT_MIN_CHG,
  minVol = config.BREAKOUT_MIN_VOL,
  regimeResult?: RegimeResult,
): { candidates: BreakoutCandidate[]; nearMisses: NearMiss[] } {
  const hotSet = new Set(hotSectors);
  const filtered = universe.filter((u) => hotSet.has(u.sector));
  const sectorRankMap = new Map<string, number>();
  const sectorScoreMap = new Map<string, number>();

  sectorScores.forEach((s, i) => {
    sectorRankMap.set(s.sector, Math.min(i + 1, 8));
    sectorScoreMap.set(s.sector, s.score);
  });

  const rawCandidates: {
    ticker: string;
    sector: string;
    chg1d: number;
    volR: number;
    R5: number;
    R20: number;
    price: number;
    regimeScore: number;
    trend?: "UPTREND" | "DOWNTREND" | "INSUFFICIENT_DATA";
    fullRegimeScore?: number;
    regimeAssessment?: "STRONG" | "CAUTION" | "AVOID";
    avgDailyVolume: number;
    sectorScore: number;
    sectorRank: number;
  }[] = [];

  const nearMisses: NearMiss[] = [];

  for (const row of filtered) {
    const candles = priceMap.get(row.ticker);
    if (!candles || candles.length < 21) continue;

    const chg1d = pctChange(candles, 1);
    const volR = volRatio(candles);
    const R5 = pctChange(candles, 5);
    const R20 = pctChange(candles, 20);
    const close = candles[candles.length - 1]!.close;
    const sma20 = sma(candles, 20);
    const avgDailyVolume = candles.slice(-20).reduce((sum, candle) => sum + candle.volume, 0) / 20;
    const trend = regimeResult ? regimeResult.tickerTrend(row.ticker, candles) : undefined;
    const fullRegimeScore = regimeResult
      ? Math.min(3, regimeResult.regimeScore + (trend === "UPTREND" ? 1 : 0))
      : 0;

    let regimeAssessment: "STRONG" | "CAUTION" | "AVOID" | undefined;
    if (regimeResult) {
      if (fullRegimeScore === 3) regimeAssessment = "STRONG";
      else if (fullRegimeScore === 2) regimeAssessment = "CAUTION";
      else regimeAssessment = "AVOID";
    }

    const sectorRank = sectorRankMap.get(row.sector) ?? 8;
    const sectorScore = sectorScoreMap.get(row.sector) ?? 0;

    const conditions: { met: boolean; label: string }[] = [
      { met: chg1d >= minChg, label: `CHG < ${(minChg * 100).toFixed(0)}%` },
      { met: volR >= minVol, label: `VOL < ${minVol.toFixed(1)}x` },
      { met: close > sma20, label: "BELOW MA20" },
      { met: R5 > 0, label: "R5 <= 0" },
    ];

    const metCount = conditions.filter((c) => c.met).length;
    const failedConditions = conditions.filter((c) => !c.met).map((c) => c.label);

    if (metCount === 4 && R20 > 0) {
      rawCandidates.push({
        ticker: row.ticker,
        sector: row.sector,
        chg1d,
        volR,
        R5,
        R20,
        price: close,
        regimeScore: fullRegimeScore,
        trend,
        fullRegimeScore,
        regimeAssessment,
        avgDailyVolume,
        sectorScore,
        sectorRank,
      });
    } else if (metCount >= 2 && metCount < 4) {
      const projectedChg1d = failedConditions.some((label) => label.startsWith("CHG"))
        ? Math.max(chg1d, minChg)
        : chg1d;
      const projectedVolRatio = failedConditions.some((label) => label.startsWith("VOL"))
        ? Math.max(volR, minVol)
        : volR;
      const projectedScore = calculateCompositeScore({
        regimeScore: fullRegimeScore,
        chg1d: projectedChg1d,
        volRatio: projectedVolRatio,
        sectorScore,
        sectorRank,
        avgDailyVolume,
      });

      nearMisses.push({
        ticker: row.ticker,
        sector: row.sector,
        chg1d,
        volRatio: volR,
        R5,
        R20,
        price: close,
        conditionsMet: metCount,
        totalConditions: 4,
        failedConditions,
        projectedScore,
        projectedGrade: projectedScore.grade,
      });
    }
  }

  let candidates: BreakoutCandidate[] = [];
  if (rawCandidates.length > 0) {
    candidates = rawCandidates.map((c) => {
      const compositeScore = calculateCompositeScore({
        regimeScore: c.regimeScore,
        chg1d: c.chg1d,
        volRatio: c.volR,
        sectorScore: c.sectorScore,
        sectorRank: c.sectorRank,
        avgDailyVolume: c.avgDailyVolume,
      });

      return {
        ticker: c.ticker,
        sector: c.sector,
        chg1d: c.chg1d,
        volRatio: c.volR,
        R5: c.R5,
        R20: c.R20,
        price: c.price,
        score: compositeScore.total,
        tickerTrend: c.trend,
        regimeScore: regimeResult ? regimeResult.regimeScore : undefined,
        fullRegimeScore: c.fullRegimeScore,
        regimeAssessment: c.regimeAssessment,
        compositeScore,
      };
    });

    candidates.sort((a, b) => b.compositeScore.total - a.compositeScore.total);
  }

  nearMisses.sort((a, b) => b.conditionsMet - a.conditionsMet || b.chg1d - a.chg1d);
  return { candidates, nearMisses: nearMisses.slice(0, 10) };
}
