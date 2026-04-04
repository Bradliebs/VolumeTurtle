"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  Line,
  ComposedChart,
} from "recharts";
import type { JournalTrade, TimeRange } from "../types";

const TIME_RANGES: TimeRange[] = ["H", "D", "W", "M", "3M", "Y"];

function filterByRange(trades: JournalTrade[], range: TimeRange): JournalTrade[] {
  if (trades.length === 0) return trades;
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
      return trades;
  }
  const filtered = trades.filter(
    (t) => t.exitDate && new Date(t.exitDate) >= cutoff,
  );
  return filtered.length > 0 ? filtered : trades;
}

interface Props {
  trades: JournalTrade[];
}

export function RRChart({ trades }: Props) {
  const [range, setRange] = useState<TimeRange>("M");

  const filtered = useMemo(
    () =>
      filterByRange(trades, range).sort((a, b) => {
        const da = a.exitDate ? new Date(a.exitDate).getTime() : 0;
        const db = b.exitDate ? new Date(b.exitDate).getTime() : 0;
        return da - db;
      }),
    [trades, range],
  );

  const chartData = useMemo(() => {
    let cumulative = 0;
    return filtered.map((t) => {
      const rr = t.rr ?? 0;
      cumulative += rr;
      const d = t.exitDate ? new Date(t.exitDate) : new Date(t.entryDate);
      return {
        ticker: t.ticker,
        date: d.toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
        }),
        rr: Math.round(rr * 100) / 100,
        cumRR: Math.round(cumulative * 100) / 100,
      };
    });
  }, [filtered]);

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span
          className="text-sm font-semibold text-[var(--dim)] tracking-wider"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          Reward:Risk
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
            <ComposedChart
              data={chartData}
              margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
            >
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
                tick={{ fill: "#666", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v} R:R`}
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
                formatter={(value, name) => {
                  const v = Number(value);
                  if (name === "rr") return [`${v.toFixed(2)} R`, "Trade"];
                  return [`${v.toFixed(2)} R`, "Total R:R"];
                }}
              />
              <Bar dataKey="rr" radius={[3, 3, 0, 0]} maxBarSize={24}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.rr >= 0 ? "var(--green)" : "var(--red)"}
                    opacity={0.85}
                  />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="cumRR"
                stroke="#888"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-[var(--dim)] text-sm">
            No closed trades
          </div>
        )}
      </div>

      {/* Legend */}
      <div
        className="flex items-center gap-4 text-[10px] text-[var(--dim)] justify-center"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-[var(--green)] opacity-85 inline-block" />
          R:R
        </span>
        <span className="flex items-center gap-1">
          <span
            className="w-4 inline-block"
            style={{
              borderTop: "1.5px dashed #888",
              display: "inline-block",
              verticalAlign: "middle",
            }}
          />
          Total R:R
        </span>
      </div>
    </div>
  );
}
