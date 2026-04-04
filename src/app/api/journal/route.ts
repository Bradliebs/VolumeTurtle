import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { getGbpUsdRate, convertToGbp } from "@/lib/currency";
import { calculateEquityCurveState } from "@/lib/risk/equityCurve";
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
  trades: Array<{
    rMultiple: number | null;
    exitPrice: number | null;
    entryPrice: number;
    shares: number;
    ticker: string;
  }>,
  gbpUsdRate: number,
): PeriodStats {
  let totalRR = 0;
  let profitGBP = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;

  for (const t of trades) {
    const r = t.rMultiple ?? 0;
    totalRR += r;
    const rawPnl =
      (t.exitPrice != null ? t.exitPrice - t.entryPrice : 0) * t.shares;
    profitGBP += convertToGbp(rawPnl, t.ticker, gbpUsdRate);

    if (r > 0.05) wins++;
    else if (r < -0.05) losses++;
    else breakeven++;
  }

  const total = trades.length;
  const winRate = total > 0 ? (wins / total) * 100 : 0;
  const pctReturn = 0; // placeholder — computed with balance context in caller

  return {
    totalRR: Math.round(totalRR * 100) / 100,
    pctReturn,
    profitGBP: Math.round(profitGBP * 100) / 100,
    winRate: Math.round(winRate * 100) / 100,
    wins,
    losses,
    breakeven,
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

    const weekStats = computePeriodStats(closedThisWeek, gbpUsdRate);
    const monthStats = computePeriodStats(closedThisMonth, gbpUsdRate);
    const yearStats = computePeriodStats(closedThisYear, gbpUsdRate);
    const allTimeStats = computePeriodStats(closedTrades, gbpUsdRate);

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
      const stats = computePeriodStats(trades, gbpUsdRate);
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
      const rawPnl =
        t.exitPrice != null
          ? (t.exitPrice - t.entryPrice) * t.shares
          : 0;
      const profitGBP = convertToGbp(rawPnl, t.ticker, gbpUsdRate);
      const pctReturn =
        t.entryPrice > 0
          ? ((t.exitPrice ?? t.entryPrice) - t.entryPrice) /
            t.entryPrice *
            100
          : 0;

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
        rr: t.rMultiple != null ? Math.round(t.rMultiple * 100) / 100 : null,
        pctReturn: Math.round(pctReturn * 100) / 100,
        profitGBP: Math.round(profitGBP * 100) / 100,
        status: t.status as "OPEN" | "CLOSED",
      };
    };

    const journalOpen = openTrades.map(mapTrade);
    const journalClosed = closedTrades.map(mapTrade);

    // ── Account metrics ──
    const equityCurve = calculateEquityCurveState(
      snapshots.map((s) => ({
        balance: s.balance,
        date: typeof s.date === "string" ? s.date : new Date(s.date as unknown as string).toISOString(),
      })),
      currentBalance,
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
