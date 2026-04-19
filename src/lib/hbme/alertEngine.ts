import { prisma } from "@/db/client";
import { fetchHistory, fetchQuote } from "@/lib/data/yahoo";
import { config } from "@/lib/config";
import { loadUniverse } from "@/lib/hbme/loadUniverse";
import { formatAlertMessage, sendTelegram } from "@/lib/telegram";

const db = prisma as unknown as {
  alert: {
    create: (args: unknown) => Promise<{ id: number }>;
    update: (args: unknown) => Promise<unknown>;
    findFirst: (args: unknown) => Promise<unknown>;
  };
  watchlistItem: {
    findMany: (args?: unknown) => Promise<Array<{ ticker: string; sector: string }>>;
  };
};

function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return (to - from) / from;
}

function sma(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function volumeRatio(volumes: number[]): number {
  if (volumes.length < 2) return 0;
  const current = volumes[volumes.length - 1]!;
  const avg = sma(volumes.slice(0, -1));
  if (avg <= 0) return 0;
  return current / avg;
}

async function createBreakoutAlert(ticker: string, sector: string, price: number, change1d: number, volR: number) {
  const message = `Breakout candidate ${ticker}: +${(change1d * 100).toFixed(1)}% / vol ${volR.toFixed(1)}x`;
  const alert = await db.alert.create({
    data: {
      type: "BREAKOUT_TRIGGER",
      ticker,
      message,
      severity: "info",
      price,
      signalSource: "momentum",
    },
  });

  try {
    const text = await formatAlertMessage({
      type: "BREAKOUT_TRIGGER",
      ticker,
      message,
      price,
      signalSource: "momentum",
      sector,
      chgPct: change1d,
      volRatio: volR,
    });
    await sendTelegram({ text });
    await db.alert.update({ where: { id: alert.id }, data: { sentTelegram: true } });
  } catch {
    // Alert persistence is primary; telegram notification is best effort.
  }

  return alert;
}

export async function runAlertCheck() {
  if (!config.MOMENTUM_ENABLED) return [];

  const watchlist = await db.watchlistItem.findMany();
  if (watchlist.length === 0) return [];

  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const alerts = [];

  for (const item of watchlist) {
    const recent = await db.alert.findFirst({
      where: {
        type: "BREAKOUT_TRIGGER",
        ticker: item.ticker,
        createdAt: { gte: fourHoursAgo },
      },
    });
    if (recent) continue;

    const quote = await fetchQuote(item.ticker);
    if (!quote || quote.regularMarketPrice == null || quote.regularMarketPreviousClose == null) continue;

    const { data: bars } = await fetchHistory(item.ticker, new Date(Date.now() - 35 * 24 * 60 * 60 * 1000));
    if (bars.length < 21) continue;

    const closes = bars.map((b) => b.close);
    const volumes = bars.slice(-21).map((b) => b.volume);
    const change1d = pctChange(quote.regularMarketPreviousClose, quote.regularMarketPrice);
    const volR = volumeRatio(volumes);
    const sma20 = sma(closes.slice(-20));
    const r5 = pctChange(closes[closes.length - 6] ?? closes[0] ?? 0, closes[closes.length - 1] ?? 0);

    if (
      change1d >= config.BREAKOUT_MIN_CHG &&
      volR >= config.BREAKOUT_MIN_VOL &&
      quote.regularMarketPrice > sma20 &&
      r5 > 0
    ) {
      const alert = await createBreakoutAlert(
        item.ticker,
        item.sector,
        quote.regularMarketPrice,
        change1d,
        volR,
      );
      alerts.push(alert);
    }
  }

  return alerts;
}

export async function runUniverseBreakoutCheck() {
  if (!config.MOMENTUM_ENABLED) return [];

  const universe = await loadUniverse();
  const watchlist = await db.watchlistItem.findMany({ select: { ticker: true } });
  const watchlistSet = new Set(watchlist.map((w: { ticker: string }) => w.ticker));

  const candidates = universe
    .filter((row) => !watchlistSet.has(row.ticker))
    .slice(0, 200);

  const alerts = [];
  for (const row of candidates) {
    const quote = await fetchQuote(row.ticker);
    if (!quote || quote.regularMarketPrice == null || quote.regularMarketPreviousClose == null) continue;

    const change1d = pctChange(quote.regularMarketPreviousClose, quote.regularMarketPrice);
    if (change1d < config.BREAKOUT_MIN_CHG) continue;

    const { data: bars } = await fetchHistory(row.ticker, new Date(Date.now() - 35 * 24 * 60 * 60 * 1000));
    if (bars.length < 21) continue;

    const volumes = bars.slice(-21).map((b) => b.volume);
    const volR = volumeRatio(volumes);
    if (volR < config.BREAKOUT_MIN_VOL) continue;

    const closes = bars.map((b) => b.close);
    const sma20 = sma(closes.slice(-20));
    if ((quote.regularMarketPrice ?? 0) <= sma20) continue;

    alerts.push(
      await createBreakoutAlert(
        row.ticker,
        row.sector,
        quote.regularMarketPrice,
        change1d,
        volR,
      ),
    );
  }

  return alerts;
}
