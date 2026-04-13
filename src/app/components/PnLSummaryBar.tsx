"use client";

import React from "react";
import type { TradeWithHistory, Trade, SyncResult } from "./types";
import { mono, fmtMoney, tickerCurrency } from "./helpers";

export interface PnLSummaryBarProps {
  openCount: number;
  openTrades: TradeWithHistory[];
  closedTrades: Trade[];
  syncData: Record<string, SyncResult>;
  t212Prices: Record<string, { currentPrice: number; ppl: number; stopLoss: number | null }> | undefined;
  gbpUsdRate: number;
}

function toGbp(amount: number, currency: string, gbpUsdRate: number): number {
  if (currency === "£") return amount;
  if (currency === "$" && gbpUsdRate > 0) return amount / gbpUsdRate;
  return amount; // fallback: treat as GBP
}

function unrealisedPnl(
  trades: TradeWithHistory[],
  syncData: Record<string, SyncResult>,
  t212Prices: Record<string, { currentPrice: number; ppl: number; stopLoss: number | null }> | undefined,
  gbpUsdRate: number,
): number {
  let total = 0;
  for (const t of trades) {
    const currency = tickerCurrency(t.ticker);

    // Best price source: syncData > t212Prices > skip
    const sync = syncData[t.id];
    const t212 = t212Prices?.[t.ticker];

    let currentPrice: number | null = null;
    if (sync?.t212?.currentPrice) {
      currentPrice = sync.t212.currentPrice;
    } else if (sync?.latestClose) {
      currentPrice = sync.latestClose;
    } else if (t212?.currentPrice) {
      currentPrice = t212.currentPrice;
    }

    if (currentPrice !== null) {
      const pnl = (currentPrice - t.entryPrice) * t.shares;
      total += toGbp(pnl, currency, gbpUsdRate);
    }
  }
  return total;
}

function realisedMtd(closedTrades: Trade[], gbpUsdRate: number): number {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  let total = 0;
  for (const t of closedTrades) {
    if (!t.exitDate || !t.exitPrice) continue;
    if (new Date(t.exitDate) < startOfMonth) continue;
    const currency = tickerCurrency(t.ticker);
    const pnl = (t.exitPrice - t.entryPrice) * t.shares;
    total += toGbp(pnl, currency, gbpUsdRate);
  }
  return total;
}

function closedThisMonth(closedTrades: Trade[]): number {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return closedTrades.filter(
    (t) => t.exitDate && new Date(t.exitDate) >= startOfMonth,
  ).length;
}

export function PnLSummaryBar({
  openCount,
  openTrades,
  closedTrades,
  syncData,
  t212Prices,
  gbpUsdRate,
}: PnLSummaryBarProps) {
  const unrealised = unrealisedPnl(openTrades, syncData, t212Prices, gbpUsdRate);
  const realised = realisedMtd(closedTrades, gbpUsdRate);
  const closedCount = closedThisMonth(closedTrades);

  const cards: { label: string; value: string; color: string }[] = [
    {
      label: "OPEN",
      value: String(openCount),
      color: "var(--dim)",
    },
    {
      label: "UNREALISED P&L",
      value: fmtMoney(Math.round(unrealised)),
      color: unrealised >= 0 ? "var(--green)" : "var(--amber)",
    },
    {
      label: "CLOSED MTD",
      value: String(closedCount),
      color: "var(--dim)",
    },
    {
      label: "REALISED MTD",
      value: fmtMoney(Math.round(realised)),
      color: realised >= 0 ? "var(--green)" : "var(--amber)",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      {cards.map((c) => (
        <div
          key={c.label}
          className="border border-[var(--border)] bg-[var(--card)] p-3"
        >
          <div
            className="text-[10px] tracking-widest text-[var(--dim)] mb-1"
            style={mono}
          >
            {c.label}
          </div>
          <div className="text-lg font-semibold" style={{ ...mono, color: c.color }}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}
