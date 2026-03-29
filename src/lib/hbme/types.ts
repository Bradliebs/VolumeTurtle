export interface Candle {
  date: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface UniverseRow {
  ticker: string;
  name: string;
  sector: string;
  market_cap: number;
}

export interface SectorScore {
  sector: string;
  score: number;
  R5: number;
  R20: number;
  volRatio: number;
}

export type TickerTrend = "UPTREND" | "DOWNTREND" | "INSUFFICIENT_DATA";

export interface CompositeBreakoutScore {
  total: number;
  grade: "A" | "B" | "C" | "D";
  components: {
    regime: number;
    breakout: number;
    sector: number;
    liquidity: number;
  };
}

export interface BreakoutCandidate {
  ticker: string;
  sector: string;
  chg1d: number;
  volRatio: number;
  R5: number;
  R20: number;
  price: number;
  score: number;
  tickerTrend?: TickerTrend;
  regimeScore?: number;
  fullRegimeScore?: number;
  regimeAssessment?: "STRONG" | "CAUTION" | "AVOID";
  compositeScore: CompositeBreakoutScore;
}

export interface NearMiss {
  ticker: string;
  sector: string;
  chg1d: number;
  volRatio: number;
  R5: number;
  R20: number;
  price: number;
  conditionsMet: number;
  totalConditions: number;
  failedConditions: string[];
  projectedScore: CompositeBreakoutScore;
  projectedGrade: "A" | "B" | "C" | "D";
}

export interface RegimeResult {
  regimeScore: number;
  tickerTrend: (ticker: string, candles: Candle[]) => TickerTrend;
}
