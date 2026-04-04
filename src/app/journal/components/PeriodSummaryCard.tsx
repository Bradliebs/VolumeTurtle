"use client";

import type { PeriodStats } from "../types";

interface Props {
  title: string;
  stats: PeriodStats;
}

function DonutChart({ winRate }: { winRate: number }) {
  const r = 28;
  const cx = 36;
  const cy = 36;
  const circ = 2 * Math.PI * r;
  const winArc = (winRate / 100) * circ;
  const lossArc = circ - winArc;

  return (
    <svg width={72} height={72} viewBox="0 0 72 72">
      {/* Loss arc (background) */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="var(--red)"
        strokeWidth={7}
        strokeDasharray={`${circ}`}
        strokeDashoffset="0"
        transform={`rotate(-90 ${cx} ${cy})`}
        opacity={0.3}
      />
      {/* Win arc */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="var(--green)"
        strokeWidth={7}
        strokeDasharray={`${winArc} ${lossArc}`}
        strokeDashoffset="0"
        transform={`rotate(-90 ${cx} ${cy})`}
        strokeLinecap="round"
      />
      {/* Center text */}
      <text
        x={cx}
        y={cy - 3}
        textAnchor="middle"
        fill="white"
        fontSize="13"
        fontWeight="700"
        fontFamily="'JetBrains Mono', monospace"
      >
        {winRate.toFixed(0)}%
      </text>
      <text
        x={cx}
        y={cy + 10}
        textAnchor="middle"
        fill="var(--dim)"
        fontSize="7"
        fontFamily="'JetBrains Mono', monospace"
      >
        WIN
      </text>
    </svg>
  );
}

function CountBadge({
  count,
  color,
}: {
  count: number;
  color: string;
}) {
  if (count === 0) return null;
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
      style={{
        backgroundColor: color,
        color: color === "#fbbf24" ? "#000" : "#fff",
        fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {count}
    </span>
  );
}

export function PeriodSummaryCard({ title, stats }: Props) {
  const isPositive = stats.totalRR >= 0;
  const rrColor = isPositive ? "var(--green)" : "var(--red)";

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-3 min-w-[200px]">
      <div className="text-xs font-semibold text-[var(--dim)] tracking-wider uppercase">
        {title}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          {/* R:R total */}
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-2xl font-bold"
              style={{ color: rrColor, fontFamily: "'JetBrains Mono', monospace" }}
            >
              {isPositive ? "+" : ""}
              {stats.totalRR.toFixed(2)}
            </span>
            <span
              className="text-xs text-[var(--dim)]"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              R:R
            </span>
          </div>

          {/* % return + £ P&L */}
          <div
            className="text-xs"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            <span style={{ color: rrColor }}>
              {isPositive ? "+" : ""}
              {stats.pctReturn.toFixed(2)} %
            </span>
          </div>
          <div
            className="text-sm font-semibold"
            style={{
              color: rrColor,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {isPositive ? "+" : ""}£
            {Math.abs(stats.profitGBP).toLocaleString("en-GB", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        </div>

        {/* Win rate donut */}
        <DonutChart winRate={stats.winRate} />
      </div>

      {/* Count badges */}
      <div className="flex items-center gap-2 pt-1">
        <CountBadge count={stats.wins} color="#22c55e" />
        <CountBadge count={stats.breakeven} color="#6b7280" />
        <CountBadge count={stats.open} color="#3b82f6" />
        <CountBadge count={stats.losses} color="#ef4444" />
      </div>
    </div>
  );
}
