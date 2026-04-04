import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { getGbpUsdRate, convertToGbp } from "@/lib/currency";
import { calculateEquityCurveState } from "@/lib/risk/equityCurve";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { loadT212Settings, getCachedT212Positions } from "@/lib/t212/client";
import type { T212Position } from "@/lib/t212/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";
import type {
  PeriodStats,
  MonthStat,
  BalancePoint,
  JournalTrade,
  JournalData,
} from "@/app/journal/types";

const log = createLogger("api/journal");

export const dynamic = "force-dynamic";

const db = prisma as unknown as {
  trade: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        ticker: string;
        entryDate: string;
        entryPrice: number;
        shares: number;
        hardStop: number;
        trailingStop: number;
        exitDate: string | null;
        exitPrice: number | null;
        exitReason: string | null;
        rMultiple: number | null;
        status: string;
        signalSource: string;
        signalGrade: string | null;
        signalScore: number | null;
      }>
    >;
  };
  accountSnapshot: {
    findMany: (args: unknown) => Promise<
      Array<{ id: string; date: string; balance: number; openTrades: number }>
    >;
    findFirst: (args: unknown) => Promise<{
      id: string;
      date: string;
      balance: number;
      openTrades: number;
    } | null>;
  };
};

const STRATEGY_LABELS: Record<string, string> = {
  volume: "Volume Spike",
  momentum: "Momentum Play",
  manual: "Manual Entry",
};

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const r = new Date(d);
  r.setDate(diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

function computePeriodStats(
  closed: Array<{
    rMultiple: number | null;
    exitPrice: number | null;
    entryPrice: number;
    shares: number;
    ticker: string;
    hardStop: number;
  }>,
  open: Array<{
    entryPrice: number;
    shares: number;
    ticker: string;
    hardStop: number;
    currentPrice: number | null;
  }>,
  gbpUsdRate: number,
): PeriodStats {
  let totalRR = 0;
  let profitGBP = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;

  // Closed trades
  for (const t of closed) {
    const r = t.rMultiple ?? 0;
    totalRR += r;
    const rawPnl =
      (t.exitPrice != null ? t.exitPrice - t.entryPrice : 0) * t.shares;
    profitGBP += convertToGbp(rawPnl, t.ticker, gbpUsdRate);

    if (r > 0.05) wins++;
    else if (r < -0.05) losses++;
    else breakeven++;
  }

  // Open trades (unrealised)
  for (const t of open) {
    if (t.currentPrice == null) continue;
    const riskPerShare = t.entryPrice - t.hardStop;
    const r = riskPerShare > 0
      ? (t.currentPrice - t.entryPrice) / riskPerShare
      : 0;
    totalRR += r;
    const rawPnl = (t.currentPrice - t.entryPrice) * t.shares;
    profitGBP += convertToGbp(rawPnl, t.ticker, gbpUsdRate);
  }

  const closedTotal = closed.length;
  const winRate = closedTotal > 0 ? (wins / closedTotal) * 100 : 0;

  return {
    totalRR: Math.round(totalRR * 100) / 100,
    pctReturn: 0, // computed with balance context in caller
    profitGBP: Math.round(profitGBP * 100) / 100,
    winRate: Math.round(winRate * 100) / 100,
    wins,
    losses,
    breakeven,
    open: open.length,
  };
}

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  try {
    const url = new URL(req.url);
    const sourceFilter = url.searchParams.get("source") ?? "all";

    // Build trade filter
    const tradeWhere: Record<string, unknown> = {};
    if (sourceFilter !== "all") {
      tradeWhere.signalSource = sourceFilter;
    }

    const [allTrades, snapshots, latestSnapshot, gbpUsdRate] =
      await Promise.all([
        db.trade.findMany({
          where: tradeWhere,
          orderBy: { entryDate: "desc" },
        }),
        db.accountSnapshot.findMany({ orderBy: { date: "asc" } }),
        db.accountSnapshot.findFirst({ orderBy: { date: "desc" } }),
        getGbpUsdRate(),
      ]);

    const currentBalance = latestSnapshot?.balance ?? 0;

    // Split open / closed
    const openTrades = allTrades.filter((t) => t.status === "OPEN");
    const closedTrades = allTrades.filter((t) => t.status === "CLOSED");

    // Fetch current prices for open trades (needed for both period stats and sidebar)
    const openTickers = openTrades.map((t) => t.ticker);
    let quoteMap: Record<string, Array<{ close: number }>> = {};
    if (openTickers.length > 0) {
      try {
        quoteMap = await fetchEODQuotes(openTickers);
      } catch (err) {
        log.warn({ err }, "Quote fetch failed for open trades");
      }
    }

    // Build open trades with current prices for period stats
    function getCurrentPrice(ticker: string): number | null {
      const quotes = quoteMap[ticker];
      if (quotes && quotes.length > 0) return quotes[quotes.length - 1]!.close;
      return null;
    }

    const openWithPrices = openTrades.map((t) => ({
      entryPrice: t.entryPrice,
      shares: t.shares,
      ticker: t.ticker,
      hardStop: t.hardStop,
      currentPrice: getCurrentPrice(t.ticker),
    }));

    // ── Period stats ──
    const now = new Date();
    const weekStart = startOfWeek(now);
    const monthStart = startOfMonth(now);
    const yearStart = startOfYear(now);

    const closedThisWeek = closedTrades.filter(
      (t) => t.exitDate && new Date(t.exitDate) >= weekStart,
    );
    const closedThisMonth = closedTrades.filter(
      (t) => t.exitDate && new Date(t.exitDate) >= monthStart,
    );
    const closedThisYear = closedTrades.filter(
      (t) => t.exitDate && new Date(t.exitDate) >= yearStart,
    );

    // Open trades by entry date
    const openThisWeek = openWithPrices.filter(
      (t) => {
        const entry = openTrades.find((o) => o.ticker === t.ticker);
        return entry && new Date(entry.entryDate) >= weekStart;
      },
    );
    const openThisMonth = openWithPrices.filter(
      (t) => {
        const entry = openTrades.find((o) => o.ticker === t.ticker);
        return entry && new Date(entry.entryDate) >= monthStart;
      },
    );
    const openThisYear = openWithPrices.filter(
      (t) => {
        const entry = openTrades.find((o) => o.ticker === t.ticker);
        return entry && new Date(entry.entryDate) >= yearStart;
      },
    );

    const weekStats = computePeriodStats(closedThisWeek, openThisWeek, gbpUsdRate);
    const monthStats = computePeriodStats(closedThisMonth, openThisMonth, gbpUsdRate);
    const yearStats = computePeriodStats(closedThisYear, openThisYear, gbpUsdRate);
    const allTimeStats = computePeriodStats(closedTrades, openWithPrices, gbpUsdRate);

    // Compute pctReturn using balance context
    if (currentBalance > 0) {
      weekStats.pctReturn =
        Math.round((weekStats.profitGBP / currentBalance) * 100 * 100) / 100;
      monthStats.pctReturn =
        Math.round((monthStats.profitGBP / currentBalance) * 100 * 100) / 100;
      yearStats.pctReturn =
        Math.round((yearStats.profitGBP / currentBalance) * 100 * 100) / 100;
      allTimeStats.pctReturn =
        Math.round((allTimeStats.profitGBP / currentBalance) * 100 * 100) / 100;
    }

    // ── Monthly stats grid ──
    const monthlyMap = new Map<string, typeof closedTrades>();
    for (const t of closedTrades) {
      if (!t.exitDate) continue;
      const d = new Date(t.exitDate);
      const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
      const arr = monthlyMap.get(key) ?? [];
      arr.push(t);
      monthlyMap.set(key, arr);
    }

    const monthlyStats: MonthStat[] = [];
    for (const [key, trades] of monthlyMap) {
      const [yearStr, monthStr] = key.split("-");
      const stats = computePeriodStats(trades, [], gbpUsdRate);
      monthlyStats.push({
        year: Number(yearStr),
        month: Number(monthStr),
        totalRR: stats.totalRR,
        profitGBP: stats.profitGBP,
        winRate: stats.winRate,
        tradeCount: trades.length,
      });
    }
    monthlyStats.sort((a, b) => a.year - b.year || a.month - b.month);

    // ── Balance history ──
    const balanceHistory: BalancePoint[] = snapshots.map((s) => ({
      date: typeof s.date === "string" ? s.date : new Date(s.date as unknown as string).toISOString(),
      balance: s.balance,
    }));

    // ── Trade lists for sidebar ──
    const mapTrade = (t: (typeof allTrades)[0]): JournalTrade => {
      // For open trades, use latest close price; for closed, use exitPrice
      let currentPrice = t.exitPrice;
      if (t.status === "OPEN" && !currentPrice) {
        currentPrice = getCurrentPrice(t.ticker);
      }

      const rawPnl =
        currentPrice != null
          ? (currentPrice - t.entryPrice) * t.shares
          : 0;
      const profitGBP = convertToGbp(rawPnl, t.ticker, gbpUsdRate);
      const pctReturn =
        t.entryPrice > 0 && currentPrice != null
          ? ((currentPrice - t.entryPrice) / t.entryPrice) * 100
          : 0;

      // Compute current R:R for open trades
      const riskPerShare = t.entryPrice - t.hardStop;
      const currentRR =
        t.rMultiple != null
          ? t.rMultiple
          : riskPerShare > 0 && currentPrice != null
            ? (currentPrice - t.entryPrice) / riskPerShare
            : null;

      return {
        id: t.id,
        ticker: t.ticker,
        direction: "LONG" as const,
        strategy: STRATEGY_LABELS[t.signalSource] ?? t.signalSource,
        signalGrade: t.signalGrade,
        entryDate:
          typeof t.entryDate === "string"
            ? t.entryDate
            : new Date(t.entryDate as unknown as string).toISOString(),
        exitDate: t.exitDate
          ? typeof t.exitDate === "string"
            ? t.exitDate
            : new Date(t.exitDate as unknown as string).toISOString()
          : null,
        rr: currentRR != null ? Math.round(currentRR * 100) / 100 : null,
        pctReturn: Math.round(pctReturn * 100) / 100,
        profitGBP: Math.round(profitGBP * 100) / 100,
        status: t.status as "OPEN" | "CLOSED",
      };
    };

    const journalOpen = openTrades.map(mapTrade);
    const journalClosed = closedTrades.map(mapTrade);

    // ── Merge untracked T212 positions into open trades ──
    const t212Settings = loadT212Settings();
    if (t212Settings) {
      try {
        const cached = await getCachedT212Positions(t212Settings);
        const trackedTickers = new Set(journalOpen.map((t) => t.ticker));
        for (const pos of cached.positions) {
          // Skip positions already tracked as trades
          if (trackedTickers.has(pos.ticker)) continue;
          const rawPnl = pos.ppl ?? 0;
          const profitGBP = convertToGbp(rawPnl, pos.ticker, gbpUsdRate);
          const pctReturn =
            pos.averagePrice > 0
              ? ((pos.currentPrice - pos.averagePrice) / pos.averagePrice) * 100
              : 0;
          journalOpen.push({
            id: `t212-${pos.ticker}`,
            ticker: pos.ticker,
            direction: "LONG",
            strategy: "T212 Position",
            signalGrade: null,
            entryDate: new Date().toISOString(),
            exitDate: null,
            rr: null,
            pctReturn: Math.round(pctReturn * 100) / 100,
            profitGBP: Math.round(profitGBP * 100) / 100,
            status: "OPEN",
          });
        }
      } catch (err) {
        log.warn({ err }, "T212 position merge failed");
      }
    }

    // ── Account metrics ──
    const equityCurve = calculateEquityCurveState(
      snapshots.map((s) => ({
        balance: s.balance,
        date: typeof s.date === "string" ? s.date : new Date(s.date as unknown as string).toISOString(),
      })),
    );

    const tradeRisk = equityCurve.riskPctPerTrade;
    const riskValue = Math.round(currentBalance * (tradeRisk / 100) * 100) / 100;

    const result: JournalData = {
      periodStats: {
        week: weekStats,
        month: monthStats,
        year: yearStats,
        allTime: allTimeStats,
      },
      monthlyStats,
      balanceHistory,
      closedTrades: journalClosed,
      openTrades: journalOpen,
      accountMetrics: {
        balance: currentBalance,
        tradeRisk,
        riskValue,
      },
    };

    return NextResponse.json(result);
  } catch (err) {
    log.error({ err }, "Journal API error");
    return NextResponse.json(
      { error: "Failed to load journal data" },
      { status: 500 },
    );
  }
}
