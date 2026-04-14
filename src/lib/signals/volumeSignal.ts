import type { DailyQuote } from "@/lib/data/fetchQuotes";
import { calculateATR } from "@/lib/risk/atr";
import { config } from "@/lib/config";
import { calculateTickerRegime, assessRegime } from "./regimeFilter";
import type { RegimeState, RegimeAssessment } from "./regimeFilter";
import { calculateCompositeScore } from "./compositeScore";
import type { CompositeScore } from "./compositeScore";

export interface VolumeSignal {
  ticker: string;
  date: string;
  close: number;
  volume: number;
  avgVolume20: number;
  volumeRatio: number;
  rangePosition: number;
  atr20: number;
  suggestedEntry: number;
  hardStop: number;
  riskPerShare: number;
  regimeAssessment: RegimeAssessment | null;
  compositeScore: CompositeScore | null;
  avgDollarVolume20: number;
}

/**
 * Simple average of daily volume over the last N days,
 * excluding the most recent day.
 */
export function calculateAverageVolume(
  quotes: DailyQuote[],
  period: number = 20,
): number {
  // Exclude the last element; take the `period` days before it
  const window = quotes.slice(-(period + 1), -1);
  if (window.length === 0) return 0;
  return window.reduce((sum, q) => sum + q.volume, 0) / window.length;
}

/**
 * True if today's volume >= config.volumeSpikeMultiplier × the average volume.
 */
export function isVolumeSpike(quotes: DailyQuote[]): boolean {
  const avg = calculateAverageVolume(quotes, config.atrPeriod);
  if (avg === 0) return false;
  const today = quotes[quotes.length - 1];
  if (!today) return false;
  return today.volume >= config.volumeSpikeMultiplier * avg;
}

/**
 * True if the close is in the top portion of the day's high-low range.
 */
export function isPriceConfirmed(quote: DailyQuote): boolean {
  if (quote.high === quote.low) return false;
  return (quote.close - quote.low) / (quote.high - quote.low) >= config.rangePositionThreshold;
}

/**
 * Generate a VolumeSignal if both volume spike and price confirmation are met.
 * If a marketRegime is provided, attaches a regime assessment to the signal.
 */
export function generateSignal(
  ticker: string,
  quotes: DailyQuote[],
  marketRegime?: RegimeState,
): VolumeSignal | null {
  const today = quotes[quotes.length - 1];
  if (!today) return null;

  if (!isVolumeSpike(quotes) || !isPriceConfirmed(today)) return null;

  const avgVolume20 = calculateAverageVolume(quotes, config.atrPeriod);
  const atr20 = calculateATR(quotes, config.atrPeriod);
  if (atr20 == null || atr20 <= 0) return null;

  const suggestedEntry = today.close;
  const riskPerShare = config.hardStopAtrMultiple * atr20;
  if (riskPerShare <= 0) return null;
  const hardStop = suggestedEntry - riskPerShare;

  let regimeAssessment: RegimeAssessment | null = null;
  if (marketRegime) {
    const tickerRegime = calculateTickerRegime(ticker, quotes);
    regimeAssessment = assessRegime(marketRegime, tickerRegime);
  }

  const volumeRatio = today.volume / avgVolume20;

  // Average daily dollar volume for liquidity scoring
  const dollarVolWindow = quotes.slice(-(config.atrPeriod + 1), -1);
  const avgDollarVolume20 = dollarVolWindow.length > 0
    ? dollarVolWindow.reduce((sum, q) => sum + q.close * q.volume, 0) / dollarVolWindow.length
    : 0;

  const compositeScore = calculateCompositeScore(regimeAssessment, volumeRatio, avgDollarVolume20);

  return {
    ticker,
    date: today.date,
    close: today.close,
    volume: today.volume,
    avgVolume20,
    volumeRatio,
    rangePosition: today.high === today.low ? 0.5 : (today.close - today.low) / (today.high - today.low),
    atr20,
    suggestedEntry,
    hardStop,
    riskPerShare: suggestedEntry - hardStop,
    regimeAssessment,
    compositeScore,
    avgDollarVolume20,
  };
}
