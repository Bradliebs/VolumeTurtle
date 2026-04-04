"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { BalancePoint, TimeRange } from "../types";

const TIME_RANGES: TimeRange[] = ["H", "D", "W", "M", "3M", "Y"];

function filterByRange(data: BalancePoint[], range: TimeRange): BalancePoint[] {
  if (data.length === 0) return data;
  const now = new Date();
  let cutoff: Date;
  switch (range) {
    case "H":
      cutoff = new Date(now.getTime() - 6 * 3600_000);
      break;
    case "D":
      cutoff = new Date(now.getTime() - 24 * 3600_000);
      break;
    case "W":
      cutoff = new Date(now.getTime() - 7 * 86400_000);
      break;
    case "M":
      cutoff = new Date(now.getTime() - 30 * 86400_000);
      break;
    case "3M":
      cutoff = new Date(now.getTime() - 90 * 86400_000);
      break;
    case "Y":
      cutoff = new Date(now.getTime() - 365 * 86400_000);
      break;
    default:
      return data;
  }
  const filtered = data.filter((d) => new Date(d.date) >= cutoff);
  return filtered.length > 0 ? filtered : data;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

interface Props {
  data: BalancePoint[];
}

export function BalanceChart({ data }: Props) {
  const [range, setRange] = useState<TimeRange>("M");

  const filtered = useMemo(() => filterByRange(data, range), [data, range]);

  const chartData = useMemo(
    () =>
      filtered.map((d) => ({
        date: formatDate(d.date),
        rawDate: d.date,
        balance: d.balance,
      })),
    [filtered],
  );

  const minBalance = useMemo(() => {
    if (chartData.length === 0) return 0;
    const min = Math.min(...chartData.map((d) => d.balance));
    return Math.floor(min * 0.995);
  }, [chartData]);

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span
          className="text-sm font-semibold text-[var(--dim)] tracking-wider"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          Account Balance
        </span>
        <div className="flex items-center gap-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded transition-all ${
                range === r
                  ? "bg-[var(--green)] text-black"
                  : "text-[var(--dim)] hover:text-white"
              }`}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[240px] w-full">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--green)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--green)"
                    stopOpacity={0.02}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fill: "#666", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[minBalance, "auto"]}
                tick={{ fill: "#666", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) =>
                  `£${(v / 1000).toFixed(1)}k`
                }
                width={55}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1a1a1a",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "var(--dim)" }}
                itemStyle={{ color: "var(--green)" }}
                formatter={(value) => [
                  `£${Number(value).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
                  "Balance",
                ]}
              />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="var(--green)"
                strokeWidth={2}
                fill="url(#balGrad)"
                dot={false}
                activeDot={{
                  r: 4,
                  stroke: "var(--green)",
                  strokeWidth: 2,
                  fill: "#0a0a0a",
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--dim)] text-sm">
            No balance history
          </div>
        )}
      </div>
    </div>
  );
}
