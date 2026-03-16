import React from "react";
import type { SnapshotForSparkline } from "./types";

export function EquitySparkline({ snapshots, peak, ma20 }: { snapshots: SnapshotForSparkline[]; peak: number; ma20: number | null }) {
  if (snapshots.length < 2) return null;

  const W = 400;
  const H = 80;
  const PAD = 4;

  const balances = snapshots.map((s) => s.balance);
  const minBal = Math.min(...balances) * 0.98;
  const maxBal = Math.max(peak, ...balances) * 1.02;
  const range = maxBal - minBal || 1;

  const toX = (i: number) => PAD + (i / (snapshots.length - 1)) * (W - 2 * PAD);
  const toY = (v: number) => H - PAD - ((v - minBal) / range) * (H - 2 * PAD);

  const linePoints = snapshots.map((s, i) => `${toX(i)},${toY(s.balance)}`).join(" ");
  const last = snapshots[snapshots.length - 1]!;
  const trending = last.balance >= snapshots[0]!.balance;
  const lineColor = trending ? "var(--green)" : "var(--red)";

  return (
    <svg width={W} height={H} className="block" style={{ maxWidth: "100%" }}>
      {/* Peak line */}
      <line x1={PAD} y1={toY(peak)} x2={W - PAD} y2={toY(peak)} stroke="var(--dim)" strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
      {/* MA20 line */}
      {ma20 !== null && (
        <line x1={PAD} y1={toY(ma20)} x2={W - PAD} y2={toY(ma20)} stroke="var(--amber)" strokeWidth={1} strokeDasharray="4 3" opacity={0.5} />
      )}
      {/* Equity line */}
      <polyline points={linePoints} fill="none" stroke={lineColor} strokeWidth={1.5} />
      {/* Current dot */}
      <circle cx={toX(snapshots.length - 1)} cy={toY(last.balance)} r={3} fill={lineColor} />
    </svg>
  );
}
