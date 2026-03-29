import type { DailyQuote } from "@/lib/data/fetchQuotes";
import YahooFinance from "yahoo-finance2";
import { withRetry } from "@/lib/retry";
import { createLogger } from "@/lib/logger";

const log = createLogger("regimeFilter");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarketRegime = "BULLISH" | "BEARISH";
export type VolatilityRegime = "NORMAL" | "ELEVATED" | "PANIC";
export type TickerTrend = "UPTREND" | "DOWNTREND" | "INSUFFICIENT_DATA";

export interface RegimeState {
  marketRegime: MarketRegime;
  qqqClose: number;
  qqq200MA: number;
  qqqPctAboveMA: number;

  volatilityRegime: VolatilityRegime;
  vixLevel: number | null;

  asOf: string;
  fetchedAt: string;
}

export interface TickerRegime {
  ticker: string;
  tickerTrend: TickerTrend;
  close: number;
  ma50: number | null;
  pctAboveMA50: number | null;
  maPeriod: number | null;
}

export interface RegimeAssessment {
  regime: RegimeState;
  tickerRegime: TickerRegime;
  overallSignal: "STRONG" | "CAUTION" | "AVOID";
  warnings: string[];
  score: number; // 0–3
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calculateSMA(quotes: DailyQuote[], period: number): number | null {
  if (quotes.length < period) return null;
  const slice = quotes.slice(-period).filter((q) => q.close != null);
  if (slice.length < period) return null;
  return slice.reduce((sum, q) => sum + q.close, 0) / slice.length;
}

// ---------------------------------------------------------------------------
// Market Regime (QQQ + VIX) — fetched with 250-day lookback
// ---------------------------------------------------------------------------

const yahooFinance = new YahooFinance();

async function fetchLongHistory(ticker: string, days: number): Promise<DailyQuote[]> {
  try {
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - days);

    const result = await withRetry(
      () => yahooFinance.chart(ticker, {
        period1: start,
        period2: now,
        interval: "1d",
      }),
      {
        maxAttempts: 3,
        baseDelayMs: 1000,
        onRetry: (err, attempt, delay) => {
          log.warn({ ticker, attempt, delayMs: Math.round(delay) }, "Retrying long history fetch");
        },
      },
    );

    const quotes = result.quotes;
    if (!quotes || quotes.length === 0) return [];

    const mapped: DailyQuote[] = [];
    for (const q of quotes) {
      if (q.open == null || q.high == null || q.low == null || q.close == null || q.volume == null) continue;
      mapped.push({
        date: q.date.toISOString().slice(0, 10),
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
      });
    }
    return mapped;
  } catch (err) {
    log.error({ ticker, err }, "Failed to fetch long history");
    return [];
  }
}

export async function calculateMarketRegime(): Promise<RegimeState> {
  // Fetch QQQ with 250+ days for 200-day SMA, and VIX with 5 days
  const [qqqQuotes, vixQuotes] = await Promise.all([
    fetchLongHistory("QQQ", 280),
    fetchLongHistory("^VIX", 5),
  ]);

  // QQQ regime
  if (qqqQuotes.length === 0) {
    log.warn("QQQ data unavailable — defaulting to BEARISH regime");
  }
  const qqqClose = qqqQuotes.length > 0 ? qqqQuotes[qqqQuotes.length - 1]!.close : 0;
  const qqq200MA = calculateSMA(qqqQuotes, 200) ?? 0;
  const qqqPctAboveMA = qqq200MA > 0 ? ((qqqClose - qqq200MA) / qqq200MA) * 100 : 0;

  const marketRegime: MarketRegime = qqqClose >= qqq200MA ? "BULLISH" : "BEARISH";

  // VIX regime
  if (vixQuotes.length === 0) {
    log.warn("VIX data unavailable — defaulting to NORMAL volatility");
  }
  const vixLevel = vixQuotes.length > 0 ? vixQuotes[vixQuotes.length - 1]!.close : null;

  let volatilityRegime: VolatilityRegime = "NORMAL";
  if (vixLevel !== null) {
    if (vixLevel > 35) volatilityRegime = "PANIC";
    else if (vixLevel > 25) volatilityRegime = "ELEVATED";
  }

  return {
    marketRegime,
    qqqClose,
    qqq200MA,
    qqqPctAboveMA,
    volatilityRegime,
    vixLevel,
    asOf: new Date().toISOString().split("T")[0]!,
    fetchedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Ticker Trend (50-day MA)
// ---------------------------------------------------------------------------

export function calculateTickerRegime(
  ticker: string,
  quotes: DailyQuote[],
): TickerRegime {
  const close = quotes.length > 0 ? quotes[quotes.length - 1]!.close : 0;

  if (quotes.length < 30) {
    log.warn(`${ticker}: only ${quotes.length} days available — need 30+ for trend calculation`);
    return {
      ticker,
      tickerTrend: "INSUFFICIENT_DATA",
      close,
      ma50: null,
      pctAboveMA50: null,
      maPeriod: null,
    };
  }

  // Use all available data up to 50 days
  const smaPeriod = Math.min(50, quotes.length);
  const ma = calculateSMA(quotes, smaPeriod);

  if (ma === null) {
    log.warn(`${ticker}: MA${smaPeriod} calculation failed despite ${quotes.length} quotes — possible data gaps`);
    return {
      ticker,
      tickerTrend: "INSUFFICIENT_DATA",
      close,
      ma50: null,
      pctAboveMA50: null,
      maPeriod: null,
    };
  }

  const pctAboveMA50 = ((close - ma) / ma) * 100;

  return {
    ticker,
    tickerTrend: close >= ma ? "UPTREND" : "DOWNTREND",
    close,
    ma50: ma,
    pctAboveMA50,
    maPeriod: smaPeriod,
  };
}

// ---------------------------------------------------------------------------
// Overall Assessment
// ---------------------------------------------------------------------------

export function assessRegime(
  regime: RegimeState,
  tickerRegime: TickerRegime,
): RegimeAssessment {
  const warnings: string[] = [];
  let score = 0;

  // Layer 1: Market regime
  if (regime.marketRegime === "BULLISH") {
    score++;
  } else {
    warnings.push(
      `Market in BEARISH regime — QQQ is ${Math.abs(regime.qqqPctAboveMA).toFixed(1)}% below 200-day MA`,
    );
  }

  // Layer 2: Volatility regime
  if (regime.volatilityRegime === "NORMAL") {
    score++;
  } else if (regime.volatilityRegime === "ELEVATED") {
    warnings.push(`VIX elevated at ${regime.vixLevel?.toFixed(1)} — increased false signal risk`);
  } else {
    warnings.push(`VIX in PANIC territory at ${regime.vixLevel?.toFixed(1)} — high false signal risk`);
  }

  // Layer 3: Ticker trend
  if (tickerRegime.tickerTrend === "UPTREND") {
    score++;
  } else if (tickerRegime.tickerTrend === "DOWNTREND") {
    warnings.push(
      `${tickerRegime.ticker} is ${Math.abs(tickerRegime.pctAboveMA50 ?? 0).toFixed(1)}% below 50-day MA — downtrend signal`,
    );
  }

  let overallSignal: RegimeAssessment["overallSignal"];
  if (score === 3) overallSignal = "STRONG";
  else if (score === 2) overallSignal = "CAUTION";
  else overallSignal = "AVOID";

  return {
    regime,
    tickerRegime,
    overallSignal,
    warnings,
    score,
  };
}
