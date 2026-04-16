import type { DailyQuote } from "@/lib/data/fetchQuotes";

export interface TrailingStopResult {
  trailingStopPrice: number;
  peakClosePrice: number;
  activeStop: number;
  stopSource: "atr" | "trailing";
  /**
   * @deprecated Not consumed anywhere. Kept for type compatibility.
   * For the real exit rule used by the nightly scan, call
   * `shouldExit()` from `@/lib/signals/exitSignal` — that is the
   * single source of truth. The two use different semantics:
   *   - exitSignal: strict `<`, window excludes today (breakout convention)
   *   - this field: `<=`, window includes today (broker-style touch)
   * Do NOT use this field without reconciling with exitSignal first.
   */
  shouldExit: boolean;
  rMultiple: number | null;
}

export function evaluateTrailingStop(
  candles: DailyQuote[],
  entryPrice: number,
  hardStopPrice: number,
  trailingStopDays = 10,
  currentPeakClose: number | null,
): TrailingStopResult {
  if (!candles || candles.length === 0) {
    return {
      trailingStopPrice: hardStopPrice,
      peakClosePrice: currentPeakClose ?? entryPrice,
      activeStop: hardStopPrice,
      stopSource: "atr",
      shouldExit: false,
      rMultiple: null,
    };
  }

  const candidateCloses = candles.map((c) => c.close);
  const peakClosePrice = Math.max(
    currentPeakClose ?? entryPrice,
    ...(candidateCloses.length > 0 ? candidateCloses : [entryPrice]),
  );

  const rollingWindow = candles.slice(-Math.max(1, trailingStopDays));
  const trailingStopPrice = Math.min(...rollingWindow.map((c) => c.close));

  const activeStop = Math.max(hardStopPrice, trailingStopPrice);
  const stopSource: "atr" | "trailing" = trailingStopPrice > hardStopPrice ? "trailing" : "atr";

  const lastClose = candles[candles.length - 1]!.close;
  const shouldExit = lastClose <= activeStop;

  const denom = entryPrice - hardStopPrice;
  const rMultiple = shouldExit && denom > 0 ? (lastClose - entryPrice) / denom : null;

  return {
    trailingStopPrice,
    peakClosePrice,
    activeStop,
    stopSource,
    shouldExit,
    rMultiple,
  };
}
