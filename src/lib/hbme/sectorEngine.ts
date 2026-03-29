import type { Candle, SectorScore, UniverseRow } from "@/lib/hbme/types";

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

function percentileRank(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const lessOrEqual = sorted.filter((v) => v <= value).length;
  return lessOrEqual / sorted.length;
}

export function scoreSectors(
  universe: UniverseRow[],
  priceMap: Map<string, Candle[]>,
): SectorScore[] {
  const sectorTickers = new Map<string, string[]>();
  for (const row of universe) {
    const list = sectorTickers.get(row.sector) ?? [];
    list.push(row.ticker);
    sectorTickers.set(row.sector, list);
  }

  const raw: { sector: string; R5: number; R20: number; volR: number }[] = [];

  sectorTickers.forEach((tickers, sector) => {
    const r5s: number[] = [];
    const r20s: number[] = [];
    const vrs: number[] = [];

    for (const ticker of tickers) {
      const candles = priceMap.get(ticker);
      if (!candles || candles.length < 21) continue;

      r5s.push(pctChange(candles, 5));
      r20s.push(pctChange(candles, 20));
      vrs.push(volRatio(candles));
    }

    if (r5s.length === 0) return;

    const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    raw.push({
      sector,
      R5: mean(r5s),
      R20: mean(r20s),
      volR: mean(vrs),
    });
  });

  const allR20 = raw.map((r) => r.R20);
  const allR5 = raw.map((r) => r.R5);
  const allVol = raw.map((r) => r.volR);

  const scores: SectorScore[] = raw.map((r) => ({
    sector: r.sector,
    R5: r.R5,
    R20: r.R20,
    volRatio: r.volR,
    score:
      0.6 * percentileRank(allR20, r.R20) +
      0.4 * percentileRank(allR5, r.R5) +
      0.3 * percentileRank(allVol, r.volR),
  }));

  return scores.sort((a, b) => b.score - a.score);
}
