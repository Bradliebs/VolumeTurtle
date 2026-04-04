"use client";

import { useState, useMemo } from "react";
import type { MonthStat, MetricView } from "../types";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const VIEWS: { label: string; value: MetricView }[] = [
  { label: "R:R", value: "rr" },
  { label: "NET %", value: "net" },
  { label: "PROFIT", value: "profit" },
  { label: "STRIKE RATE", value: "strike" },
];

interface Props {
  stats: MonthStat[];
}

function cellValue(
  stat: MonthStat | undefined,
  view: MetricView,
): { primary: string; secondary: string; tertiary: string; isPositive: boolean } {
  if (!stat) return { primary: "", secondary: "", tertiary: "", isPositive: true };

  switch (view) {
    case "rr": {
      const isPos = stat.totalRR >= 0;
      return {
        primary: `${isPos ? "+" : ""}${stat.totalRR.toFixed(2)} R:R`,
        secondary: `£${Math.abs(stat.profitGBP).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        tertiary: `${stat.winRate.toFixed(0)}%`,
        isPositive: isPos,
      };
    }
    case "net": {
      // Use profitGBP as a proxy for net %
      const isPos = stat.profitGBP >= 0;
      return {
        primary: `${isPos ? "+" : ""}${stat.profitGBP >= 0 ? "+" : ""}${stat.totalRR.toFixed(2)} R`,
        secondary: `${stat.tradeCount} trades`,
        tertiary: `${stat.winRate.toFixed(0)}%`,
        isPositive: isPos,
      };
    }
    case "profit": {
      const isPos = stat.profitGBP >= 0;
      return {
        primary: `${isPos ? "+" : "-"}£${Math.abs(stat.profitGBP).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        secondary: `${stat.tradeCount} trades`,
        tertiary: `${stat.totalRR.toFixed(2)} R`,
        isPositive: isPos,
      };
    }
    case "strike": {
      const isPos = stat.winRate >= 50;
      return {
        primary: `${stat.winRate.toFixed(1)}%`,
        secondary: `${stat.tradeCount} trades`,
        tertiary: `${stat.totalRR.toFixed(2)} R`,
        isPositive: isPos,
      };
    }
  }
}

export function MonthlyStatsTable({ stats }: Props) {
  const [view, setView] = useState<MetricView>("rr");

  // Group by year
  const years = useMemo(() => {
    const yearSet = new Set(stats.map((s) => s.year));
    return Array.from(yearSet).sort((a, b) => b - a);
  }, [stats]);

  const statMap = useMemo(() => {
    const map = new Map<string, MonthStat>();
    for (const s of stats) {
      map.set(`${s.year}-${s.month}`, s);
    }
    return map;
  }, [stats]);

  // Year totals
  const yearTotals = useMemo(() => {
    const totals = new Map<number, MonthStat>();
    for (const year of years) {
      const yearStats = stats.filter((s) => s.year === year);
      const totalRR = yearStats.reduce((s, v) => s + v.totalRR, 0);
      const profitGBP = yearStats.reduce((s, v) => s + v.profitGBP, 0);
      const totalTrades = yearStats.reduce((s, v) => s + v.tradeCount, 0);
      const winWeighted = yearStats.reduce(
        (s, v) => s + v.winRate * v.tradeCount,
        0,
      );
      const winRate = totalTrades > 0 ? winWeighted / totalTrades : 0;
      totals.set(year, {
        year,
        month: 0,
        totalRR: Math.round(totalRR * 100) / 100,
        profitGBP: Math.round(profitGBP * 100) / 100,
        winRate: Math.round(winRate * 100) / 100,
        tradeCount: totalTrades,
      });
    }
    return totals;
  }, [years, stats]);

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-3 overflow-x-auto">
      <div className="flex items-center justify-between">
        <span
          className="text-sm font-semibold text-[var(--dim)] tracking-wider"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          Monthly Stats
        </span>
        <div className="flex items-center gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              onClick={() => setView(v.value)}
              className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${
                view === v.value
                  ? "bg-[var(--green)] text-black"
                  : "text-[var(--dim)] hover:text-white"
              }`}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-[900px]">
        <table className="w-full text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          <thead>
            <tr className="text-[var(--dim)] border-b border-[var(--border)]">
              <th className="text-left py-2 px-2 w-16">Year</th>
              {MONTHS.map((m) => (
                <th key={m} className="text-center py-2 px-1">
                  {m}
                </th>
              ))}
              <th className="text-center py-2 px-2 font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr
                key={year}
                className="border-b border-[var(--border)] last:border-b-0"
              >
                <td className="py-3 px-2 font-bold text-white">{year}</td>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                  const stat = statMap.get(`${year}-${month}`);
                  const cv = cellValue(stat, view);
                  return (
                    <td key={month} className="py-3 px-1 text-center">
                      {cv.primary ? (
                        <div className="flex flex-col gap-0.5">
                          <span
                            className="font-semibold text-[11px]"
                            style={{
                              color: cv.isPositive
                                ? "var(--green)"
                                : "var(--red)",
                            }}
                          >
                            {cv.primary}
                          </span>
                          <span
                            className="text-[9px]"
                            style={{
                              color: cv.isPositive
                                ? "var(--green)"
                                : "var(--red)",
                              opacity: 0.7,
                            }}
                          >
                            {cv.secondary}
                          </span>
                          <span className="text-[9px] text-[var(--dim)]">
                            {cv.tertiary}
                          </span>
                        </div>
                      ) : null}
                    </td>
                  );
                })}
                <td className="py-3 px-2 text-center">
                  {(() => {
                    const total = yearTotals.get(year);
                    if (!total) return null;
                    const cv = cellValue(total, view);
                    return (
                      <div className="flex flex-col gap-0.5">
                        <span
                          className="font-bold text-[11px]"
                          style={{
                            color: cv.isPositive
                              ? "var(--green)"
                              : "var(--red)",
                          }}
                        >
                          {cv.primary}
                        </span>
                        <span
                          className="text-[9px] font-semibold"
                          style={{
                            color: cv.isPositive
                              ? "var(--green)"
                              : "var(--red)",
                            opacity: 0.7,
                          }}
                        >
                          {cv.secondary}
                        </span>
                        <span className="text-[9px] text-[var(--dim)]">
                          {cv.tertiary}
                        </span>
                      </div>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {years.length === 0 && (
        <div className="text-center text-[var(--dim)] text-sm py-8">
          No monthly data available
        </div>
      )}
    </div>
  );
}
